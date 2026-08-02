<?php
/**
 * Preckon demo-form configuration.
 *
 * EDIT THE VALUES BELOW, then upload alongside submit.php.
 * Nothing here is served to visitors — .htaccess blocks direct access to
 * .php config files, and PHP source is executed, never displayed.
 */

return [

    // ---------------------------------------------------------------
    // Where demo requests are delivered
    // ---------------------------------------------------------------
    'to'          => 'sales@preckon.com',
    'to_name'     => 'Preckon Sales',

    // Optional extra recipients (BCC). Leave empty to skip.
    'bcc'         => [],

    // ---------------------------------------------------------------
    // The address the notification is SENT FROM.
    //
    // IMPORTANT: this must be a real mailbox on a domain you control
    // (create it in IONOS -> Email). Using the visitor's address here
    // would fail SPF/DMARC and land in spam — the visitor's address goes
    // in Reply-To instead, so hitting Reply in your inbox works.
    // ---------------------------------------------------------------
    'from'        => 'no-reply@preckon.com',
    'from_name'   => 'Preckon Website',

    // ---------------------------------------------------------------
    // SMTP. Strongly recommended over PHP mail() — authenticated sending
    // through your own mailbox passes SPF and lands in inboxes.
    //
    // IONOS values (confirm in IONOS -> Email -> your mailbox -> settings):
    //   host = smtp.ionos.com   port = 587   secure = 'tls'
    //   (or port 465 with secure = 'ssl')
    //
    // Set 'enabled' => false to fall back to PHP mail(). The form still
    // works either way; deliverability is just worse without SMTP.
    // ---------------------------------------------------------------
    'smtp' => [
        'enabled'  => true,
        'host'     => 'smtp.ionos.com',
        'port'     => 587,
        'secure'   => 'tls',              // 'tls' for 587, 'ssl' for 465
        'username' => 'no-reply@preckon.com',
        'password' => 'CHANGE-ME',        // <-- the mailbox password
        'timeout'  => 20,
    ],

    // ---------------------------------------------------------------
    // Send the person who filled the form a confirmation email.
    // ---------------------------------------------------------------
    'autoreply'   => true,

    // ---------------------------------------------------------------
    // Abuse controls
    // ---------------------------------------------------------------
    'max_per_ip_per_hour' => 5,
    'min_fill_seconds'    => 3,   // submissions faster than this are bots

    // Where the CSV backup of every lead is written. Kept even when mail
    // fails, so a submission is never silently lost.
    'data_dir'    => __DIR__ . '/_data',
];
