# SUBVerse
This is a collection of tools and scripts to help with managing a subversion repository used in a university setting for game development, animation, and software engineering projects.

It is WIP and being developed with features specific to our situation in the CS and GDD programs at UW Stout Polytechnic. It targets running on a Synology NAS using the container app but with the services being managed from the command prompt and a custom docker compose stack.

## Contents
- `subversion`: A container stack with Apache2 for web-dav access and IF.SVNAdmin for management.
- `portainer`: A simple portainer container to monitor the compose stack.
- `traefik`: A reverse proxy that plays nice with Docker and routes subdomains to services running inside containers.
- `accountant`: A simple nodejs server that allows basic user account management for Subversion (with groups and password recovery).
- `dsm_scripts`: Some helper scripts for Synology's Disk Station Manager OS (to free up reserved ports and other management tasks).

## Future Plans
Future features that are being worked on concurrently:
- Support for git repos (likely via self-hosted gitea, forgejo, or GitLab CE)
- Support for project management surrounding classes and rich inclusion of metadata.
- Auto generation of public facing website for projects (hosted elsewhere).
- Centralizing user accounts across all services (svn, git, and others) likely involving an open, self-hosted OAuth solution (Authentik, etc.)
