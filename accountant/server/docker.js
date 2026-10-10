import Docker from 'dockerode'
const docker = new Docker()

/**
 * Run a command in a docker container. Provides a promisified
 * interface to the basic Dockerode.exec command.
 *
 * @param {string} containerName
 * @param {string[]} command
 * @param {string} [input] Optional string written to the process' stdin
 *   (enables AttachStdin on the exec). Useful for feeding file contents to
 *   commands like `cat > /path/to/file` without shell-quoting headaches.
 * @returns {Promise<Object>}
 */
export async function execCommand (containerName, command, input = null) {
  // Connect to container and prepare command object
  const container = docker.getContainer(containerName)
  const exec = await container.exec({
    Cmd: command,
    AttachStdout: true,
    AttachStderr: true,
    ...(input !== null && { AttachStdin: true })
  })

  // Strings to hold stdout and stderr
  let output = ''
  let error = ''

  // Start the command and demux the stream. When feeding stdin, hijack is
  // required: without a socket upgrade the daemon never treats the request
  // body as stdin, so the command hangs waiting for input that never arrives
  // (dockerode v5). With hijack, start() resolves to a bidirectional socket
  // whose .write()/end() deliver the input and close it.
  const stream = await exec.start(input !== null ? { hijack: true, stdin: true } : {})
  return new Promise((resolve, reject) => {
    container.modem.demuxStream(
      stream,
      { write: (chunk) => { output += chunk.toString() } },
      { write: (chunk) => { error += chunk.toString() } }
    )

    // Feed stdin (if any) and close it so the command sees EOF
    if (input !== null) {
      stream.write(input)
      stream.end()
    }

    // When stream ends resolve the promise
    stream.on('end', async () => {
      try {
        const result = await exec.inspect()

        resolve({
          output,
          error,
          exitCode: result.ExitCode
        })
      } catch (err) {
        reject(err)
      }
    })

    // If error occurs, reject the promise
    stream.on('error', reject)
  })
}
