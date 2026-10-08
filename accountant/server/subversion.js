import { execCommand } from './docker.js'

const SVN_CONTAINER_NAME = process.env.SVN_CONTAINER_NAME ?? 'svn_gateway_ur'

/**
 * Creates a svn repo in the docker container
 *
 * @param {Object} projectInfo (should match the prisma project model)
 * @returns {Promise<void>}
 */
export async function createRepository (projectInfo) {
  // Get repo name
  const repoName = projectInfo.slug
  if (!repoName || repoName === '') {
    throw new Error('Missing project name')
  }

  // Construct the repo
  await execCommand(
    SVN_CONTAINER_NAME,
    ['svnadmin', 'create', `/var/svn/${repoName}`])
    .catch((err) => { throw err })
    .then((result) => {
      if (result.exitCode !== 0) {
        throw new Error(result.error)
      }
    })

  // Fix permissions
  await execCommand(
    SVN_CONTAINER_NAME,
    ['chown', '-R', 'apache:apache', `/var/svn/${repoName}`])
    .catch((err) => { throw err })
    .then((result) => {
      if (result.exitCode !== 0) {
        throw new Error(result.error)
      }
    })

  // TODO: Apply the standard monorepo structure
  // - Adds trunk, branches, tags folders as first commit

  // TODO: Apply default snv-props according to the project type
  // - Need to set 'needs-lock' default props
  // - Need to set a good 'svn:ignore' prop on root
}

/**
 * Creates a svn repo in the docker container
 *
 * @param {Object} projectInfo (should match the prisma project model w/ a populated assignments array)
 * @returns {Promise<void>}
 */
export async function synchronizeRepositoryAccess (projectInfo) {
  // TODO: Adjust the password file to ensure it includes login credentials for all users of the project

  // TODO: Adjust the svn-access file to ensure there is a group that includes all the assigned users and the teacher

  // TODO: Make sure the group has full r/w access to the repo
}
