import 'dotenv/config'
import nodemailer from 'nodemailer'

/**
 * Base URL of the client application that verification links point to.
 * Override with APP_BASE_URL in the environment (defaults to the Vite dev server).
 */
export const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:5173'

let transporter

/**
 * Lazily build the SMTP transport from the Brevo credentials in .env.
 * Throws when required variables are missing so misconfiguration is reported
 * by the caller instead of failing silently.
 */
function getTransporter () {
  if (!transporter) {
    const host = process.env.SMTP_SERVER
    const port = parseInt(process.env.SMTP_PORT, 10) || 587
    const user = process.env.SMTP_LOGIN
    const pass = process.env.SMTP_KEY

    if (!host || !user || !pass) {
      throw new Error('SMTP not configured: set SMTP_SERVER, SMTP_PORT, SMTP_LOGIN and SMTP_KEY')
    }

    transporter = nodemailer.createTransport({
      host,
      port,
      // Brevo: STARTTLS on 587, implicit TLS on 465
      secure: port === 465,
      auth: { user, pass }
    })
  }
  return transporter
}

/** Build the URL a user clicks to verify their email address. */
export function buildVerificationUrl (token) {
  const base = APP_BASE_URL.replace(/\/+$/, '')
  return `${base}/verify?token=${encodeURIComponent(token)}`
}

/** Build the URL a user clicks to reset their password. */
export function buildResetUrl (token) {
  const base = APP_BASE_URL.replace(/\/+$/, '')
  return `${base}/reset-password?token=${encodeURIComponent(token)}`
}

/**
 * Send an email-verification message containing the verification link for
 * the given token to the user's address.
 */
export async function sendVerificationEmail (user, token) {
  const url = buildVerificationUrl(token)
  const firstName = user.first_name || user.username

  return getTransporter().sendMail({
    from: `"Accountant" <${process.env.SMTP_LOGIN}>`,
    to: user.email,
    subject: 'Verify your email address',
    text: [
      `Hi ${firstName},`,
      '',
      'An account was created for you on the Accountant system.',
      'Please verify your email address by opening the link below:',
      '',
      url,
      '',
      'If you did not create this account, you can ignore this message.'
    ].join('\n'),
    html: [
      `<p>Hi ${firstName},</p>`,
      '<p>An account was created for you on the Accountant system.</p>',
      '<p>Please verify your email address by opening the link below:</p>',
      `<p><a href="${url}">${url}</a></p>`,
      '<p>If you did not create this account, you can ignore this message.</p>'
    ].join('\n')
  })
}

/**
 * Send a password-reset message containing the reset link for the given
 * token to the user's address.
 */
export async function sendPasswordResetEmail (user, token) {
  const url = buildResetUrl(token)
  const firstName = user.first_name || user.username

  return getTransporter().sendMail({
    from: `"Accountant" <${process.env.SMTP_LOGIN}>`,
    to: user.email,
    subject: 'Reset your password',
    text: [
      `Hi ${firstName},`,
      '',
      'A password reset was requested for your account on the Accountant system.',
      'Open the link below to choose a new password:',
      '',
      url,
      '',
      'This link will expire shortly. If you did not request a reset,',
      'you can ignore this message - your password will remain unchanged.'
    ].join('\n'),
    html: [
      `<p>Hi ${firstName},</p>`,
      '<p>A password reset was requested for your account on the Accountant system.</p>',
      '<p>Open the link below to choose a new password:</p>',
      `<p><a href="${url}">${url}</a></p>`,
      '<p>This link will expire shortly. If you did not request a reset, you can ignore this message - your password will remain unchanged.</p>'
    ].join('\n')
  })
}
