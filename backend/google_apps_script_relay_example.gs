// TINTA zero-budget email relay for Render.
// This runs in the Google account that should send TINTA verification emails.
// 1) Copy into https://script.google.com/ under the sending Google account.
// 2) Change RELAY_TOKEN to your own long random secret.
// 3) Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone.
// 4) Put the deployed /exec URL in Render as TINTA_EMAIL_RELAY_URL.
// 5) Put the same token in Render as TINTA_EMAIL_RELAY_TOKEN.

const RELAY_TOKEN = 'CHANGE_THIS_TO_A_LONG_RANDOM_SECRET';

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.token !== RELAY_TOKEN) {
      return json({ ok: false, error: 'Unauthorized' });
    }

    const to = String(body.to || '').trim();
    const code = String(body.code || '').trim();
    const ttl = Number(body.ttl_minutes || 15);

    if (!to || !/^\d{6}$/.test(code)) {
      return json({ ok: false, error: 'Invalid email or code' });
    }

    const subject = 'Verify your TINTA account';
    const text =
      'Your TINTA verification code is: ' + code + '\n\n' +
      'This code expires in ' + ttl + ' minutes.\n' +
      'If you did not create a TINTA account, you can ignore this email.';

    GmailApp.sendEmail(to, subject, text, { name: 'TINTA' });
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
