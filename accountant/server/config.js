import 'dotenv/config'

/**
 * Unique name of this deployment, read from SITE_NAME in .env.
 * Used to brand outbound mail and server logs so each installation
 * is identifiable (e.g. "Stout Repo Depot").
 */
export const SITE_NAME = (process.env.SITE_NAME || '').trim()

/**
 * Full application name ("{SITE_NAME} Accountant") used in email From
 * headers, email bodies and server log messages. Falls back to plain
 * "Accountant" when SITE_NAME is not configured.
 */
export const APP_NAME = SITE_NAME ? `${SITE_NAME} Accountant` : 'Accountant'
