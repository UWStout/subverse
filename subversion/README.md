# Subversion Docker Container
## Based on (elleFlorio/svn-docker)[https://github.com/elleFlorio/svn-docker]
A Docker container to run subversion with Apache2 for web-dav access. Like the container by Luca Florio, it uses alpine linux and s6 for service management.

This was initially created by following (Luca's blog post)[https://medium.com/@elle.florio/the-svn-dockerization-84032e11d88d] (which required fixing several character errors likely caused by copy-pasting script files). I also introduced the IF.SVNAdmin additions which were present in the repository but not mentioned in the blog post.

## Differences from elleFlorio's docker image
- Swapped from the 'smebberson' alpine-s6 base to the newer crazymax/alpine-s6 base.
- Adjusted services for apache and subversion to use s6-overlay v3 syntax (based on s6-rc).
- Clones the IF.SVNAdmin repo for latest dev changes (instead of using the 1.6.2 zip archive).
