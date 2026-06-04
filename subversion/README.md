# Subversion Docker Container
## Based on [elleFlorio/svn-docker](https://github.com/elleFlorio/svn-docker)
A Docker container to run subversion with Apache2 for web-dav access. Like the container by Luca Florio, it uses alpine linux and s6 for service management.

This was initially created by following [Luca's blog post](https://medium.com/@elle.florio/the-svn-dockerization-84032e11d88d) (which required fixing several character errors likely caused by copy-pasting script files). I also introduced the IF.SVNAdmin additions which were present in the repository but not mentioned in the blog post.

## Differences from elleFlorio's docker image
- Swapped from the 'smebberson' alpine-s6 base to the newer crazymax/alpine-s6 base.
- Adjusted services for apache and subversion to use s6-overlay v3 syntax (based on s6-rc).
- Clones the IF.SVNAdmin repo for latest dev changes (instead of using the 1.6.2 zip archive).
- SVNAdmin is now a separate service orchestrated with docker compose. Main subversion service now excludes PHP entirely.
- Config files for Apache, Subversion, PHP, and IF.SVNAdmin are mounted from local folders allowing for easy customization.
- Updated the apache and subversion configurations to harden security and disable unneeded features.
- Switched to using the more standard /var/svn folder as the repo root
- Main S6 Apache and svnserve services no longer run as root
