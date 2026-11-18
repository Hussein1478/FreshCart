
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

function getSecretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;

  if (!key) {
    throw new Error('PAYSTACK_SECRET_KEY is not configured');
  }

  return key;
}

function toPaystackAmount(amount) {
  const value = Number(amount);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Invalid payment amount');
  }

  return String(Math.round(value * 100));
}

async function request(path, options = {}) {
  const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getSecretKey()}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || !result.status) {
  console.error('Paystack API diagnostic:', {
    httpStatus: response.status,
    apiStatus: result.status,
    message: result.message,
    chargeStatus: result.data?.status,
    displayText: result.data?.display_text
  });

  throw new Error(result.message || 'Paystack request failed');
}

  return result.data;
}

async function initializeTransaction({
  email,
  amount,
  reference,
  callbackUrl,
  metadata
}) {
  return request('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email,
      amount: toPaystackAmount(amount),
      currency: 'KES',
      reference,
      callback_url: callbackUrl,
      channels: ['card'],
      metadata
    })
  });
}

async function chargeMobileMoney({
  email,
  amount,
  reference,
  phone,
  provider = 'mpesa',
  metadata
}) {
      if (!['mpesa', 'atl'].includes(String(provider).toLowerCase())) {
    throw new Error('Unsupported Mobile Money provider');
  }
    if (!/^\+?[0-9]{9,15}$/.test(String(phone || '').trim())) {
    throw new Error('Invalid Mobile Money phone number');
  }
  return request('/charge', {
    method: 'POST',
    body: JSON.stringify({
      email,
      amount: toPaystackAmount(amount),
      currency: 'KES',
      reference,
      mobile_money: {
        phone,
        provider
      },
      metadata
    })
  });
}




async function verifyTransaction(reference) {
  return request(
    `/transaction/verify/${encodeURIComponent(reference)}`
  );
}


function verifyWebhookSignature(rawBody, headers = {}) {
  const crypto = require('crypto');

  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    return false;
  }

  const signature = headers['x-paystack-signature'];

  if (
    typeof signature !== 'string' ||
    !/^[0-9a-f]{128}$/i.test(signature)
  ) {
    return false;
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    throw new Error('PAYSTACK_SECRET_KEY is not configured');
  }

  const expected = crypto
    .createHmac('sha512', secretKey)
    .update(rawBody)
    .digest();

  const actual = Buffer.from(signature, 'hex');

  return crypto.timingSafeEqual(actual, expected);
}

module.exports = {
  initializeTransaction,
  chargeMobileMoney,
  verifyTransaction,
  verifyWebhookSignature
};