import Docker from 'dockerode'
const docker = new Docker()

/**
 * Run a command in a docker container. Provides a promisified
 * interface to the basic Dockerode.exec command.
 *
 * @param {string} containerName
 * @param {string[]} command
 * @returns {Promise<Object>}
 */
export async function execCommand (containerName, command) {
  // Connect to container and prepare command object
  const container = docker.getContainer(containerName)
  const exec = await container.exec({
    Cmd: command,
    AttachStdout: true,
    AttachStderr: true
  })

  // Strings to hold stdout and stderr
  let output = ''
  let error = ''

  // Start the command and demux the stream
  const stream = await exec.start()
  return new Promise((resolve, reject) => {
    container.modem.demuxStream(
      stream,
      { write: (chunk) => { output += chunk.toString() } },
      { write: (chunk) => { error += chunk.toString() } }
    )

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
