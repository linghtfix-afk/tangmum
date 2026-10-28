// Netlify Functions: ทำหน้าที่เป็นตัวกลางที่ปลอด CORS
import { createHmac } from 'node:crypto';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  }
});

export default async (request) => {
  if (request.method !== 'POST') return json({ok: false, error: 'Method not allowed'}, 405);
  const url = process.env.GAS_URL;
  const secret = process.env.GAS_SECRET;
  if (!url || !secret) return json({ok: false, error: 'ยังไม่ได้ตั้งค่า GAS_URL และ GAS_SECRET ใน Netlify'}, 500);
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url))
    return json({ok: false, error: 'GAS_URL ต้องเป็นลิงก์ /exec ของ Apps Script'}, 500);
  try {
    const raw = await request.text();
    if (raw.length > 10000) return json({ok: false, error: 'ข้อมูลมีขนาดใหญ่เกินไป'}, 413);
    const input = JSON.parse(raw || '{}');
    if (!['list', 'add', 'replies', 'reply'].includes(input.action))
      return json({ok: false, error: 'คำสั่งไม่ถูกต้อง'}, 400);

    const ip = request.headers.get('x-nf-client-connection-ip') ||
      (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
    const clientKey = createHmac('sha256', secret).update(ip).digest('hex').slice(0, 40);
    const payload = {
      secret,
      clientKey,
      action: input.action,
      postId: input.postId,
      nickname: input.nickname,
      title: input.title,
      category: input.category,
      body: input.body
    };

    const upstream = await fetch(url, {
      method: 'POST',
      headers: {'content-type': 'text/plain; charset=utf-8'},
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: AbortSignal.timeout(20000)
    });
    if (!upstream.ok) return json({ok: false, error: 'Google Apps Script ไม่ตอบสนองตามปกติ'}, 502);
    const text = await upstream.text();
    let result;
    try { result = JSON.parse(text); }
    catch { return json({ok: false, error: 'Apps Script ส่งข้อมูลที่ไม่ใช่ JSON กรุณาตรวจการ Deploy /exec'}, 502); }
    return json(result, result.ok ? 200 : 400);
  } catch (error) {
    const timeout = error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return json({ok: false, error: timeout ? 'การเชื่อมต่อหมดเวลา' : 'เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่'}, 502);
  }
};
