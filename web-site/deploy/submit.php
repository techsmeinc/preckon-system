<?php
/**
 * Preckon demo-request handler.
 *
 * Accepts the form on /demo and /ar/demo, emails it to sales, sends the
 * visitor a confirmation, and appends every submission to a CSV so a lead
 * survives even if mail delivery fails.
 *
 * Returns JSON: {ok:true, ref:"PRECKON-DEMO-XXXXX"} or {ok:false, error:"..."}
 */

declare(strict_types=1);

mb_internal_encoding('UTF-8');   // so mb_substr never splits a UTF-8 sequence

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

/** Emit a JSON response and stop. */
function respond(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

$L = [
    'en' => [
        'bad_method' => 'Method not allowed.',
        'invalid'    => 'Please check the highlighted fields.',
        'rate'       => 'Too many requests. Please try again later, or email sales@preckon.com.',
        'server'     => 'We could not send your request. Please email sales@preckon.com and we will pick it up.',
    ],
    'ar' => [
        'bad_method' => 'طريقة الطلب غير مسموح بها.',
        'invalid'    => 'يرجى مراجعة الحقول المحددة.',
        'rate'       => 'طلبات كثيرة جدًا. يرجى المحاولة لاحقًا أو مراسلتنا على sales@preckon.com.',
        'server'     => 'تعذّر إرسال طلبك. يرجى مراسلتنا على sales@preckon.com وسنتابعه.',
    ],
];

$config = require __DIR__ . '/config.php';

// ------------------------------------------------------------ self-test
// GET /submit.php?selftest=<token>  — reports which transports are configured
// and sends one real test message to the 'to' address. Disabled unless
// selftest_token is set in config.php. Delete the token once you are live.
if (isset($_GET['selftest'])) {
    $token = (string)($config['selftest_token'] ?? '');
    if ($token === '' || !hash_equals($token, (string)$_GET['selftest'])) {
        respond(404, ['ok' => false, 'error' => 'Not found.']);
    }
    require_once __DIR__ . '/_lib/mail.php';

    $report = [
        'php'            => PHP_VERSION,
        'curl'           => function_exists('curl_init'),
        'openssl'        => extension_loaded('openssl'),
        'allow_url_fopen'=> (bool)ini_get('allow_url_fopen'),
        'brevo_ready'    => brevo_ready($config),
        'smtp_ready'     => smtp_ready($config),
        'php_mail'       => (bool)($config['allow_php_mail'] ?? false),
        'from'           => $config['from'],
        'to'             => $config['to'],
        'data_dir_writable' => is_dir((string)$config['data_dir'])
            ? is_writable((string)$config['data_dir'])
            : is_writable(dirname((string)$config['data_dir'])),
    ];
    $res = deliver($config, [
        'from_email' => $config['from'],
        'from_name'  => $config['from_name'],
        'to_email'   => $config['to'],
        'to_name'    => $config['to_name'],
        'subject'    => 'Preckon form self-test',
        'html'       => '<p>Self-test from submit.php. If you are reading this, the demo form can send mail.</p>',
        'text'       => 'Self-test from submit.php. If you are reading this, the demo form can send mail.',
    ]);
    respond($res['ok'] ? 200 : 500, ['ok' => $res['ok'], 'transport' => $res['transport'],
        'errors' => $res['errors'], 'env' => $report]);
}

// --------------------------------------------------------------- input
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(405, ['ok' => false, 'error' => $L['en']['bad_method']]);
}

$raw = file_get_contents('php://input') ?: '';
$in  = [];
if (str_contains($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) {
    $in = json_decode($raw, true) ?: [];
} else {
    $in = $_POST;
}

$locale = (($in['locale'] ?? 'en') === 'ar') ? 'ar' : 'en';
$t      = $L[$locale];

$field = static fn(string $k, int $max = 2000): string
    => trim(mb_substr((string)($in[$k] ?? ''), 0, $max));

$name    = $field('name', 120);
$company = $field('company', 160);
$email   = $field('email', 190);
$role    = $field('role', 80);
$bids    = $field('bids', 40);
$notes   = $field('notes', 4000);

// ------------------------------------------------------- spam controls
// 1. Honeypot: a field hidden from humans. Bots fill everything in.
if ($field('website') !== '') {
    // Pretend it worked so the bot does not retry with a different shape.
    respond(200, ['ok' => true, 'ref' => 'PRECKON-DEMO-000000']);
}

// 2. Time trap: a real person cannot complete this form in under 3 seconds.
$ts = (int)($in['ts'] ?? 0);
if ($ts > 0) {
    $elapsed = time() - (int)($ts / 1000);
    if ($elapsed >= 0 && $elapsed < (int)$config['min_fill_seconds']) {
        respond(200, ['ok' => true, 'ref' => 'PRECKON-DEMO-000000']);
    }
}

// ------------------------------------------------------ validation
$errors = [];
if (mb_strlen($name) < 2)    { $errors[] = 'name'; }
if (mb_strlen($company) < 2) { $errors[] = 'company'; }
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) { $errors[] = 'email'; }

// Header-injection guard: no CR/LF may reach a mail header.
foreach ([$name, $company, $email] as $v) {
    if (preg_match('/[\r\n]/', $v)) { $errors[] = 'invalid'; }
}
if ($errors) {
    respond(422, ['ok' => false, 'error' => $t['invalid'], 'fields' => array_values(array_unique($errors))]);
}

// --------------------------------------------------------- rate limit
$dataDir = (string)$config['data_dir'];
if (!is_dir($dataDir)) {
    @mkdir($dataDir, 0700, true);
}
// Deny web access to the data directory even if it sits inside the webroot.
if (is_dir($dataDir) && !file_exists("$dataDir/.htaccess")) {
    @file_put_contents("$dataDir/.htaccess", "Require all denied\n");
    @file_put_contents("$dataDir/index.html", '');
}

$ip      = (string)($_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
$ip      = trim(explode(',', $ip)[0]);
$rateKey = "$dataDir/rate-" . hash('sha256', $ip) . '.txt';
$hits    = [];
if (is_readable($rateKey)) {
    $hits = array_filter(
        array_map('intval', explode("\n", (string)file_get_contents($rateKey))),
        static fn(int $x): bool => $x > time() - 3600
    );
}
if (count($hits) >= (int)$config['max_per_ip_per_hour']) {
    respond(429, ['ok' => false, 'error' => $t['rate']]);
}
$hits[] = time();
@file_put_contents($rateKey, implode("\n", $hits), LOCK_EX);

// -------------------------------------------------------------- record
$ref = 'PRECKON-DEMO-' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 5));
$row = [
    gmdate('c'), $ref, $locale, $name, $company, $email,
    $role, $bids, str_replace(["\r", "\n"], ' ', $notes), $ip,
];

$csv    = "$dataDir/leads.csv";
$isNew  = !file_exists($csv);
if ($fh = @fopen($csv, 'a')) {
    @flock($fh, LOCK_EX);
    if ($isNew) {
        fputcsv($fh, ['utc', 'ref', 'locale', 'name', 'company', 'email', 'role', 'bids', 'notes', 'ip']);
    }
    fputcsv($fh, $row);
    @flock($fh, LOCK_UN);
    fclose($fh);
}

// ---------------------------------------------------------------- mail
require_once __DIR__ . '/_lib/mail.php';

$esc  = static fn(string $v): string => htmlspecialchars($v, ENT_QUOTES, 'UTF-8');
$rows = [
    'Name'    => $name,
    'Company' => $company,
    'Email'   => $email,
    'Role'    => $role ?: '—',
    'Bids/mo' => $bids ?: '—',
    'Language'=> $locale === 'ar' ? 'Arabic (/ar/demo)' : 'English (/demo)',
    'Ref'     => $ref,
    'IP'      => $ip,
];

$htmlRows = '';
$textRows = '';
foreach ($rows as $k => $v) {
    $htmlRows .= '<tr><td style="padding:6px 14px 6px 0;color:#64748B;font:13px system-ui">'
        . $esc((string)$k) . '</td><td style="padding:6px 0;color:#0B1B2B;font:600 14px system-ui">'
        . $esc((string)$v) . '</td></tr>';
    $textRows .= str_pad((string)$k, 10) . ': ' . $v . "\n";
}
$notesHtml = $notes !== '' ? '<p style="margin:18px 0 0;color:#334155;font:14px/1.6 system-ui;white-space:pre-wrap">'
    . $esc($notes) . '</p>' : '';
$notesText = $notes !== '' ? "\nNotes:\n$notes\n" : '';

// ---- 1. notification to sales -------------------------------------------
$sent = deliver($config, [
    'from_email'  => $config['from'],
    'from_name'   => $config['from_name'],
    'to_email'    => $config['to'],
    'to_name'     => $config['to_name'],
    'reply_email' => $email,          // Reply in your inbox goes to them
    'reply_name'  => $name,
    'bcc'         => (array)($config['bcc'] ?? []),
    'subject'     => "Demo request — $company ($name)",
    'html'        => '<div style="max-width:560px"><h2 style="font:600 18px system-ui;color:#0B1B2B;margin:0 0 4px">'
        . 'New demo request</h2><p style="font:13px system-ui;color:#64748B;margin:0 0 16px">'
        . 'Submitted via preckon.com</p><table cellpadding="0" cellspacing="0">'
        . $htmlRows . '</table>' . $notesHtml . '</div>',
    'text'        => "New demo request — preckon.com\n\n$textRows$notesText",
]);

// ---- 2. confirmation to the visitor, in their language -------------------
// Attempted independently of the notification: if the notification bounced for a
// recipient-specific reason, the visitor should still get their thank-you.
if (!empty($config['autoreply'])) {
    if ($locale === 'ar') {
        // Braces are required: PHP allows bytes 0x80-0xFF in identifiers, so
        // "$name،" would parse the Arabic comma as part of the variable name.
        $reply = [
            'subject' => 'استلمنا طلب العرض التوضيحي — Preckon',
            'html'    => '<div dir="rtl" style="max-width:560px;font:15px/1.9 system-ui;color:#334155">'
                . '<p>مرحبًا ' . $esc($name) . '،</p>'
                . '<p>شكرًا لطلبك عرضًا توضيحيًا لـPreckon. وصلنا طلبك وسنتواصل معك خلال يوم عمل واحد لتحديد موعد.</p>'
                . '<p>جهّز مجموعة مخططات واحدة من مشروع حقيقي — سنُمرّرها عبر السلسلة كاملة مباشرة في المكالمة.</p>'
                . '<p style="color:#64748B;font-size:13px">رقم المرجع: ' . $esc($ref) . '</p>'
                . '<p style="color:#64748B;font-size:13px">فريق Preckon · sales@preckon.com</p></div>',
            'text'    => "مرحبًا {$name}،\n\nشكرًا لطلبك عرضًا توضيحيًا لـPreckon. سنتواصل معك خلال يوم عمل واحد.\n\nرقم المرجع: {$ref}\n\nفريق Preckon",
        ];
    } else {
        $reply = [
            'subject' => 'We received your demo request — Preckon',
            'html'    => '<div style="max-width:560px;font:15px/1.7 system-ui;color:#334155">'
                . '<p>Hi ' . $esc($name) . ',</p>'
                . '<p>Thanks for requesting a Preckon demo. We have your request and will be in touch '
                . 'within one business day to find a time.</p>'
                . '<p>Have one drawing set from a real project ready — we will run it through the whole '
                . 'chain live on the call.</p>'
                . '<p style="color:#64748B;font-size:13px">Reference: ' . $esc($ref) . '</p>'
                . '<p style="color:#64748B;font-size:13px">The Preckon team · sales@preckon.com</p></div>',
            'text'    => "Hi {$name},\n\nThanks for requesting a Preckon demo. We'll be in touch within one business day.\n\nReference: {$ref}\n\nThe Preckon team",
        ];
    }
    deliver($config, $reply + [
        'from_email'  => $config['from'],
        'from_name'   => 'Preckon',
        'to_email'    => $email,
        'to_name'     => $name,
        'reply_email' => $config['to'],
        'reply_name'  => $config['to_name'],
    ]);
}

// The lead is already in the CSV, so a mail failure is recoverable — but the
// visitor must not be told "thanks" if nothing reached anyone.
if (!$sent['ok']) {
    $payload = ['ok' => false, 'error' => $t['server'], 'ref' => $ref];
    if (!empty($config['debug'])) {
        $payload['debug'] = $sent['errors'];   // only when explicitly enabled
    }
    respond(500, $payload);
}

respond(200, ['ok' => true, 'ref' => $ref]);
