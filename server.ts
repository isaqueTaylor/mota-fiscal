import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_INSTRUCTION = `Você é um Especialista em Contabilidade Digital e Processamento de Documentos para o mercado brasileiro. Sua missão é receber imagens ou PDFs de documentos fiscais (NF-e, NFC-e, NFS-e ou Recibos) e extrair os dados com precisão cirúrgica para alimentar um banco de dados Firebase.

### REGRAS DE EXTRAÇÃO:
1. IDENTIFICAÇÃO: Diferencie o EMISSOR (quem vendeu) do DESTINATÁRIO (o usuário do bot). Foque nos dados do EMISSOR.
2. VALORES: Extraia o Valor Total da Nota. Se houver descontos, ignore o valor bruto e foque no valor líquido final pago.
3. DATAS: Extraia a 'Data de Emissão'. Ignore datas de vencimento de boletos anexos.
4. CATEGORIZAÇÃO: Com base nos itens da nota, classifique o gasto em uma destas categorias: [Mercadoria para Revenda, Matéria-prima, Ferramentas/Equipamentos, Aluguel/Luz/Água, Marketing/Anúncios, Manutenção, Outros].

### FORMATO DE SAÍDA (ESTRITAMENTE JSON):
Retorne APENAS o objeto JSON abaixo, sem textos explicativos antes ou depois:

{
  "estabelecimento": "Nome Fantasia ou Razão Social do Emissor",
  "cnpj_emissor": "00.000.000/0000-00",
  "data_emissao": "AAAA-MM-DD",
  "valor_total": 0.00,
  "categoria_sugerida": "Nome da Categoria",
  "itens_resumo": "Breve descrição dos principais itens (ex: 10 tubos de aço, 2 luvas)",
  "chave_acesso": "Apenas se for NF-e/NFC-e (44 dígitos)",
  "confianca_extracao": "Alta/Média/Baixa"
}

### TRATAMENTO DE ERROS:
- Se a imagem estiver ilegível, retorne: {"erro": "IMAGEM_ILEGIVEL"}.
- Se o documento não for uma nota fiscal ou recibo, retorne: {"erro": "DOCUMENTO_INVALIDO"}.`;

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Parse JSON bodies
  app.use(express.json());

  // --- WHATSAPP WEBHOOK ---
  
  // 1. Webhook Verification (GET)
  app.get('/api/webhook', (req, res) => {
    // Fallback para facilitar os testes iniciais se a variável não estiver configurada
    const verify_token = process.env.WHATSAPP_VERIFY_TOKEN || "meu_token_secreto_123";
    
    let mode = req.query["hub.mode"];
    let token = req.query["hub.verify_token"];
    let challenge = req.query["hub.challenge"];

    if (mode && token) {
      if (mode === "subscribe" && token === verify_token) {
        console.log("WEBHOOK_VERIFIED");
        res.status(200).send(challenge);
      } else {
        res.sendStatus(403);
      }
    } else {
      res.sendStatus(400);
    }
  });

  // 2. Receive Messages (POST)
  app.post('/api/webhook', async (req, res) => {
    const body = req.body;

    if (body.object) {
      if (
        body.entry &&
        body.entry[0].changes &&
        body.entry[0].changes[0] &&
        body.entry[0].changes[0].value.messages &&
        body.entry[0].changes[0].value.messages[0]
      ) {
        const phoneNumberId = body.entry[0].changes[0].value.metadata.phone_number_id;
        const from = body.entry[0].changes[0].value.messages[0].from; // sender number
        const msg = body.entry[0].changes[0].value.messages[0];

        // Acknowledge receipt immediately to Meta
        res.sendStatus(200);

        try {
          let mediaId = null;
          let mimeType = null;

          if (msg.type === 'image') {
            mediaId = msg.image.id;
            mimeType = msg.image.mime_type;
          } else if (msg.type === 'document') {
            mediaId = msg.document.id;
            mimeType = msg.document.mime_type;
          }

          if (mediaId) {
            // Send processing message
            await sendWhatsAppMessage(phoneNumberId, from, "Recebi seu documento. Analisando com IA, aguarde um momento...");

            // 1. Get Media URL
            const mediaRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
              headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}` }
            });
            const mediaData = await mediaRes.json();
            
            if (mediaData.url) {
              // 2. Download Media
              const downloadRes = await fetch(mediaData.url, {
                headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}` }
              });
              const arrayBuffer = await downloadRes.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);
              const base64Data = buffer.toString('base64');

              // 3. Process with Gemini
              const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: [
                  {
                    inlineData: {
                      data: base64Data,
                      mimeType: mimeType || 'image/jpeg',
                    },
                  },
                  { text: "Extraia os dados deste documento." }
                ],
                config: {
                  systemInstruction: SYSTEM_INSTRUCTION,
                  responseMimeType: "application/json",
                  temperature: 0.1,
                },
              });

              if (response.text) {
                const parsedData = JSON.parse(response.text);
                
                if (parsedData.erro) {
                   await sendWhatsAppMessage(phoneNumberId, from, `Erro: ${parsedData.erro}`);
                } else {
                   // Format response
                   const replyText = `✅ *Dados Extraídos com Sucesso!*\n\n` +
                     `*Emissor:* ${parsedData.estabelecimento || '-'}\n` +
                     `*CNPJ:* ${parsedData.cnpj_emissor || '-'}\n` +
                     `*Data:* ${parsedData.data_emissao || '-'}\n` +
                     `*Valor Total:* R$ ${parsedData.valor_total || '-'}\n` +
                     `*Categoria:* ${parsedData.categoria_sugerida || '-'}\n\n` +
                     `*Resumo:* ${parsedData.itens_resumo || '-'}`;
                     
                   await sendWhatsAppMessage(phoneNumberId, from, replyText);
                }
              }
            }
          } else {
            // Not an image or document
            await sendWhatsAppMessage(phoneNumberId, from, "Olá! Por favor, envie uma foto ou PDF de uma nota fiscal ou recibo para eu extrair os dados.");
          }
        } catch (error) {
          console.error("Error processing WhatsApp message:", error);
          await sendWhatsAppMessage(phoneNumberId, from, "Desculpe, ocorreu um erro ao processar seu documento.");
        }
      } else {
        res.sendStatus(200); // Acknowledge other webhook events
      }
    } else {
      res.sendStatus(404);
    }
  });

  async function sendWhatsAppMessage(phoneNumberId: string, to: string, text: string) {
    if (!process.env.WHATSAPP_TOKEN) return;
    
    await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to,
        text: { body: text },
      }),
    });
  }

  // --- VITE MIDDLEWARE ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
