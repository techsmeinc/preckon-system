<?php
/**
 * Preckon demo-form configuration.
 *
 * EDIT THE VALUES BELOW, then upload alongside submit.php.
 * .htaccess denies web access to this file, and PHP source is executed
 * rather than served — so the API key is not exposed.
 */

return [

    // ---------------------------------------------------------------
    // Where demo requests are delivered
    // ---------------------------------------------------------------
    'to'          => 'sales@preckon.com',
    'to_name'     => 'Preckon Sales',
    'bcc'         => [],                    // optional extra recipients

    // ---------------------------------------------------------------
    // The address notifications are SENT FROM.
    //
    // This must be a sender Brevo has verified (see setup below). The
    // visitor's address goes in Reply-To, so replying from your inbox
    // still reaches them — sending "as" the visitor would fail DMARC.
    // ---------------------------------------------------------------
    'from'        => 'no-reply@preckon.com',
    'from_name'   => 'Preckon Website',

    // ===============================================================
    // TRANSPORT 1 — BREVO (recommended)
    //
    // Uses Brevo's HTTP API over port 443. Shared hosting frequently
    // blocks outbound SMTP ports, which silently breaks mail; HTTPS is
    // never blocked, so this is the reliable option here.
    //
    // SETUP
    //   1. brevo.com -> sign up (free tier: 300 emails/day)
    //   2. Senders, Domains & Dedicated IPs -> Domains -> add preckon.com
    //      and add the DNS records it gives you in IONOS (Domains & SSL
    //      -> preckon.com -> DNS). Authenticating the domain is what puts
    //      mail in inboxes instead of spam.
    //   3. Senders -> add no-reply@preckon.com and verify it
    //   4. SMTP & API -> API Keys -> Generate a new API key
    //   5. Paste it below. It starts with "xkeysib-".
    // ===============================================================
    'brevo' => [
        'enabled'  => true,
        'api_key'  => 'xkeysib-YOUR-API-KEY-HERE',
        'api_base' => 'https://api.brevo.com/v3',
        'timeout'  => 20,
    ],

    // ===============================================================
    // TRANSPORT 2 — SMTP (fallback, tried only if Brevo fails)
    //
    // Either Brevo's relay:
    //     host = smtp-relay.brevo.com   port = 587   secure = 'tls'
    //     username = your Brevo SMTP login
    //     password = your Brevo SMTP key (not your account password)
    //
    // Or IONOS's own:
    //     host = smtp.ionos.com   port = 587   secure = 'tls'
    //     username/password = a real mailbox on your domain
    //
    // Leave the password as CHANGE-ME to skip this transport entirely.
    // ===============================================================
    'smtp' => [
        'enabled'  => true,
        'host'     => 'smtp-relay.brevo.com',
        'port'     => 587,
        'secure'   => 'tls',              // 'tls' for 587, 'ssl' for 465
        'username' => '',
        'password' => 'CHANGE-ME',
        'timeout'  => 20,
    ],

    // ---------------------------------------------------------------
    // TRANSPORT 3 — PHP mail(). Last resort, poor deliverability.
    // ---------------------------------------------------------------
    'allow_php_mail' => true,

    // ---------------------------------------------------------------
    // Send the person who filled the form a confirmation email.
    // ---------------------------------------------------------------
    'autoreply'   => true,

    // ---------------------------------------------------------------
    // Diagnostics
    //
    // Set a long random string to enable GET /submit.php?selftest=<token>,
    // which reports what is configured and sends one test email to 'to'.
    // Leave empty (or clear it once you are live) to disable the endpoint.
    // ---------------------------------------------------------------
    'selftest_token' => '',

    // Include transport error detail in the form's JSON error response.
    // Useful while setting up; turn off afterwards.
    'debug'       => false,

    // ---------------------------------------------------------------
    // Abuse controls
    // ---------------------------------------------------------------
    'max_per_ip_per_hour' => 5,
    'min_fill_seconds'    => 3,   // submissions faster than this are bots

    // CSV backup of every lead, written before mail is attempted so a
    // submission is never lost to a delivery failure.
    'data_dir'    => __DIR__ . '/_data',
];
