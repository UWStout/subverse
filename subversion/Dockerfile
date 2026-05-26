FROM crazymax/alpine-s6

# Install Apache2 with modules and utilities and Subversion
RUN apk update &&\
 apk add --no-cache apache2 apache2-utils apache2-webdav mod_dav_svn &&\
 apk add --no-cache subversion

# Create directories and empty password file
RUN mkdir -p /run/apache2/ && mkdir /home/svn/ && mkdir /etc/subversion &&\
 touch /etc/subversion/passwd

# Add access control file for SVNAuth
ADD subversion-access-control /etc/subversion/subversion-access-control
RUN chmod a+w /etc/subversion/* && chmod a+w /home/svn

# Install PHP with extensions for SVNAdmin
RUN apk add --no-cache git php84 php84-apache2 php84-session php84-json php84-ldap php84-xml &&\
	sed -i 's/;extension=ldap/extension=ldap/' /etc/php84/php.ini

# Install svn-admin package
RUN git clone --depth 1 https://github.com/mfreiholz/iF.SVNAdmin.git ./svnadmin &&\
	mv ./svnadmin /opt/svnadmin &&\
	ln -s /opt/svnadmin /var/www/localhost/htdocs/svnadmin &&\
	chmod -R 777 /opt/svnadmin/data

# ADD svnadmin/classes/util/global.func.php /opt/svnadmin/classes/util/global.func.php

# Add WebDav configuration
ADD dav_svn.conf /etc/apache2/conf.d/dav_svn.conf

# Add services configurations (s6-overlay v3)
ADD services/apache/ /etc/s6-overlay/s6-rc.d/apache/
ADD services/subversion/ /etc/s6-overlay/s6-rc.d/subversion/

# Add our services to the user bundle for startup
RUN touch /etc/s6-overlay/s6-rc.d/user/contents.d/apache &&\
  touch /etc/s6-overlay/s6-rc.d/user/contents.d/subversion
