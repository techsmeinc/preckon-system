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
    // The address notifications are SENT FROM. Must match the SMTP
    // mailbox below. The visitor'"'"'s address goes in Reply-To, so replying
    // from your inbox still reaches them — sending "as" the visitor
    // would fail SPF/DMARC and land in spam.
    // ---------------------------------------------------------------
    'from'        => 'no-reply@preckon.com',
    'from_name'   => 'Preckon Website',

    // ===============================================================
    // TRANSPORT 1 — IONOS SMTP   <<< THE ONE YOU NEED TO FILL IN
    //
    // Uses the no-reply@preckon.com mailbox you created in
    // IONOS -> Email. Authenticated sending from your own domain, so
    // SPF passes and mail lands in inboxes.
    //
    //   username = the FULL email address, not just "no-reply"
    //   password = the mailbox password you set when creating it
    //
    // If port 587 is blocked, try port 465 with secure => 'ssl'.
    // ===============================================================
    'smtp' => [
        'enabled'  => true,
        'host'     => 'smtp.ionos.com',
        'port'     => 587,
        'secure'   => 'tls',                    // 'tls' for 587, 'ssl' for 465
        'username' => 'no-reply@preckon.com',
        'password' => 'CHANGE-ME',              // <-- the mailbox password
        'timeout'  => 20,
    ],

    // ===============================================================
    // TRANSPORT 2 — BREVO (optional backup, off by default)
    //
    // Only worth enabling if IONOS SMTP turns out to be blocked or
    // unreliable. Uses an HTTPS API on port 443 rather than an SMTP
    // port, so it works where SMTP is filtered.
    //
    //   brevo.com -> Senders & Domains -> verify preckon.com
    //             -> SMTP & API -> API Keys -> generate ("xkeysib-...")
    // ===============================================================
    'brevo' => [
        'enabled'  => false,
        'api_key'  => 'xkeysib-YOUR-API-KEY-HERE',
        'api_base' => 'https://api.brevo.com/v3',
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
