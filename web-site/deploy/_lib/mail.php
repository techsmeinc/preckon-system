<?php
/**
 * Mail transport chain for the Preckon demo form.
 *
 * Tries each configured transport in order and stops at the first success:
 *
 *   1. SMTP             — IONOS (or any authenticated relay), via PHPMailer.
 *   2. Brevo HTTP API   — optional backup. Outbound HTTPS on 443, so it still
 *                         works if the host filters outbound SMTP ports.
 *   3. PHP mail()       — last resort; poor deliverability.
 *
 * deliver() returns ['ok' => bool, 'transport' => string, 'errors' => string[]]
 */

declare(strict_types=1);

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception as MailException;

require_once __DIR__ . '/PHPMailer/Exception.php';
require_once __DIR__ . '/PHPMailer/PHPMailer.php';
require_once __DIR__ . '/PHPMailer/SMTP.php';

const PLACEHOLDER = ['CHANGE-ME', '', 'xkeysib-YOUR-API-KEY-HERE'];

/** Is the Brevo transport usable? */
function brevo_ready(array $config): bool
{
    $b = $config['brevo'] ?? [];
    return !empty($b['enabled'])
        && !in_array((string)($b['api_key'] ?? ''), PLACEHOLDER, true);
}

/** Is the SMTP transport usable? */
function smtp_ready(array $config): bool
{
    $s = $config['smtp'] ?? [];
    return !empty($s['enabled'])
        && !in_array((string)($s['password'] ?? ''), PLACEHOLDER, true);
}

/**
 * Send through Brevo's transactional API.
 * @return array{0:bool,1:string} [ok, error]
 */
function send_brevo(array $config, array $msg): array
{
    $b   = $config['brevo'];
    $url = rtrim((string)($b['api_base'] ?? 'https://api.brevo.com/v3'), '/') . '/smtp/email';

    $payload = [
        'sender'      => ['name' => $msg['from_name'], 'email' => $msg['from_email']],
        'to'          => [['email' => $msg['to_email'], 'name' => $msg['to_name']]],
        'subject'     => $msg['subject'],
        'htmlContent' => $msg['html'],
        'textContent' => $msg['text'],
    ];
    if (!empty($msg['reply_email'])) {
        $payload['replyTo'] = ['email' => $msg['reply_email'], 'name' => $msg['reply_name'] ?: $msg['reply_email']];
    }
    if (!empty($msg['bcc'])) {
        $payload['bcc'] = array_map(static fn($e) => ['email' => $e], (array)$msg['bcc']);
    }

    $body    = json_encode($payload, JSON_UNESCAPED_UNICODE);
    $headers = ['accept: application/json', 'content-type: application/json', 'api-key: ' . $b['api_key']];
    $timeout = (int)($b['timeout'] ?? 20);

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_CONNECTTIMEOUT => 10,
        ]);
        $res  = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err  = curl_error($ch);
        curl_close($ch);
        if ($res === false) {
            return [false, 'brevo: curl: ' . $err];
        }
    } else {
        // cURL missing — fall back to the stream wrapper.
        $ctx = stream_context_create(['http' => [
            'method'        => 'POST',
            'header'        => implode("\r\n", $headers),
            'content'       => $body,
            'timeout'       => $timeout,
            'ignore_errors' => true,
        ]]);
        $res  = @file_get_contents($url, false, $ctx);
        $code = 0;
        foreach ($http_response_header ?? [] as $h) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) { $code = (int)$m[1]; }
        }
        if ($res === false) {
            return [false, 'brevo: request failed (allow_url_fopen / network blocked)'];
        }
    }

    if ($code >= 200 && $code < 300) {
        return [true, ''];
    }
    $detail = '';
    $j = json_decode((string)$res, true);
    if (is_array($j)) {
        $detail = trim((string)($j['message'] ?? '') . ' ' . (string)($j['code'] ?? ''));
    }
    return [false, "brevo: HTTP $code " . ($detail ?: substr((string)$res, 0, 200))];
}

/**
 * Send via PHPMailer (SMTP, or PHP mail() when $useSmtp is false).
 * @return array{0:bool,1:string} [ok, error]
 */
function send_phpmailer(array $config, array $msg, bool $useSmtp): array
{
    try {
        $m = new PHPMailer(true);
        $m->CharSet  = 'UTF-8';
        $m->Encoding = 'base64';

        if ($useSmtp) {
            $s = $config['smtp'];
            $m->isSMTP();
            $m->Host     = $s['host'];
            $m->Port     = (int)$s['port'];
            $m->Username = (string)$s['username'];
            $m->Password = (string)$s['password'];
            $m->SMTPAuth = $m->Username !== '';
            $m->Timeout  = (int)($s['timeout'] ?? 20);

            $secure = strtolower((string)($s['secure'] ?? 'tls'));
            if ($secure === 'ssl') {
                $m->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
            } elseif ($secure === 'none') {
                $m->SMTPSecure  = '';
                $m->SMTPAutoTLS = false;
            } else {
                $m->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
            }
        } else {
            $m->isMail();
        }

        $m->setFrom($msg['from_email'], $msg['from_name']);
        $m->addAddress($msg['to_email'], $msg['to_name']);
        foreach ((array)($msg['bcc'] ?? []) as $b) { $m->addBCC($b); }
        if (!empty($msg['reply_email'])) {
            $m->addReplyTo($msg['reply_email'], $msg['reply_name'] ?: '');
        }
        $m->Subject = $msg['subject'];
        $m->isHTML(true);
        $m->Body    = $msg['html'];
        $m->AltBody = $msg['text'];
        $m->send();
        return [true, ''];
    } catch (MailException|Throwable $e) {
        return [false, ($useSmtp ? 'smtp: ' : 'mail(): ') . $e->getMessage()];
    }
}

/**
 * Try every configured transport in order.
 * @return array{ok:bool,transport:string,errors:string[]}
 */
function deliver(array $config, array $msg): array
{
    $errors = [];

    if (smtp_ready($config)) {
        [$ok, $err] = send_phpmailer($config, $msg, true);
        if ($ok) { return ['ok' => true, 'transport' => 'smtp', 'errors' => []]; }
        $errors[] = $err;
        @error_log('[preckon-demo] ' . $err);
    }

    if (brevo_ready($config)) {
        [$ok, $err] = send_brevo($config, $msg);
        if ($ok) { return ['ok' => true, 'transport' => 'brevo', 'errors' => $errors]; }
        $errors[] = $err;
        @error_log('[preckon-demo] ' . $err);
    }

    if (!empty($config['allow_php_mail'])) {
        [$ok, $err] = send_phpmailer($config, $msg, false);
        if ($ok) { return ['ok' => true, 'transport' => 'mail()', 'errors' => $errors]; }
        $errors[] = $err;
        @error_log('[preckon-demo] ' . $err);
    }

    if (!$errors) {
        $errors[] = 'no transport configured — set the SMTP password in config.php';
    }
    return ['ok' => false, 'transport' => 'none', 'errors' => $errors];
}
