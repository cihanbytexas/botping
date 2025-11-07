import WebSocket from "ws";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Sadece POST istekleri kabul edilir." });
  }

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    return res.status(500).json({ success: false, error: "Bot token .env dosyasında bulunamadı!" });
  }

  let channelId;
  try {
    const body = req.body || {};
    channelId = body.channel_id;
    if (!channelId) {
      return res.status(400).json({ success: false, error: "JSON body'de channel_id eksik!" });
    }
  } catch {
    return res.status(400).json({ success: false, error: "Geçersiz JSON body!" });
  }

  const startApiPing = Date.now();

  try {
    // 1️⃣ Discord API ping ölçümü
    const apiRes = await fetch("https://discord.com/api/v10/gateway/bot", {
      headers: { Authorization: `Bot ${token}` },
    });
    const apiPing = Date.now() - startApiPing;

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      return res.status(401).json({
        success: false,
        error: "Token geçersiz veya yetkisiz",
        detail: errText,
      });
    }

    const { url } = await apiRes.json();

    // 2️⃣ Gateway ping (WebSocket ile)
    const ws = new WebSocket(`${url}?v=10&encoding=json`);
    let gatewayPing = null;
    let startTime;
    let messagePing = null;

    ws.on("message", async (msg) => {
      const payload = JSON.parse(msg);
      const { op, d } = payload;

      // OP 10: Hello -> Heartbeat başlat
      if (op === 10) {
        ws.send(
          JSON.stringify({
            op: 2,
            d: {
              token,
              intents: 0,
              properties: {
                os: "linux",
                browser: "ping-api",
                device: "ping-api",
              },
            },
          })
        );

        // İlk heartbeat
        startTime = Date.now();
        ws.send(JSON.stringify({ op: 1, d: null }));
      }

      // OP 11: Heartbeat ACK -> latency hesapla
      if (op === 11) {
        gatewayPing = Date.now() - startTime;

        // 3️⃣ Gerçek mesaj ping
        const msgStart = Date.now();
        const sendRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bot ${token}`,
          },
          body: JSON.stringify({ content: "📡 Ping testi..." }),
        });

        const msgEnd = Date.now();
        messagePing = msgEnd - msgStart;

        // Başarılıysa mesajı sil
        if (sendRes.ok) {
          const data = await sendRes.json();
          await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${data.id}`, {
            method: "DELETE",
            headers: { Authorization: `Bot ${token}` },
          });
        }

        ws.close();
      }
    });

    ws.on("close", () => {
      if (gatewayPing !== null) {
        res.status(200).json({
          success: true,
          apiPing: apiPing + "ms",
          gatewayPing: gatewayPing + "ms",
          messagePing: messagePing + "ms",
          timestamp: new Date().toISOString(),
        });
      } else {
        res.status(500).json({ success: false, error: "Ping ölçülemedi" });
      }
    });

    ws.on("error", (err) => {
      res.status(500).json({ success: false, error: err.message });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
