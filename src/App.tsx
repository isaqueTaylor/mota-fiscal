import React, { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2, Image as ImageIcon, Database, File as FileIcon } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';

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

type ExtractedData = {
  estabelecimento?: string;
  cnpj_emissor?: string;
  data_emissao?: string;
  valor_total?: number;
  categoria_sugerida?: string;
  itens_resumo?: string;
  chave_acesso?: string;
  confianca_extracao?: string;
  erro?: string;
};

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ExtractedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (selectedFile: File | null) => {
    if (!selectedFile) return;
    
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
    if (!validTypes.includes(selectedFile.type)) {
      setError('Formato não suportado. Envie uma imagem (JPG, PNG) ou PDF.');
      return;
    }

    setFile(selectedFile);
    setError(null);
    setResult(null);

    if (selectedFile.type.startsWith('image/')) {
      const url = URL.createObjectURL(selectedFile);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null); // PDF preview can be handled differently or just show an icon
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const processDocument = async () => {
    if (!file) return;

    setIsProcessing(true);
    setError(null);
    setResult(null);

    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          {
            inlineData: {
              data: base64Data,
              mimeType: file.type,
            },
          },
          { text: "Extraia os dados deste documento." }
        ],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          temperature: 0.1, // Low temperature for more deterministic extraction
        },
      });

      if (response.text) {
        const parsedData = JSON.parse(response.text) as ExtractedData;
        setResult(parsedData);
      } else {
        throw new Error("Resposta vazia da IA.");
      }
    } catch (err: any) {
      console.error("Erro ao processar documento:", err);
      setError(err.message || "Ocorreu um erro ao processar o documento.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        
        <header className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 flex items-center justify-center gap-2">
            <FileText className="w-8 h-8 text-blue-600" />
            Extrator de Notas Fiscais
          </h1>
          <p className="text-gray-500 max-w-2xl mx-auto">
            Envie uma foto ou PDF de uma NF-e, NFC-e, NFS-e ou recibo. Nossa IA extrairá os dados automaticamente para o seu sistema contábil.
          </p>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Upload Section */}
          <div className="space-y-6">
            <div 
              className={
                "border-2 border-dashed rounded-2xl p-8 text-center transition-colors cursor-pointer " +
                (isDragging ? "border-blue-500 bg-blue-50 " : "border-gray-300 hover:border-blue-400 bg-white ") +
                (file ? "border-green-500 bg-green-50/30" : "")
              }
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
              />
              
              {!file ? (
                <div className="flex flex-col items-center space-y-4">
                  <div className="p-4 bg-blue-100 rounded-full">
                    <Upload className="w-8 h-8 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-lg font-medium text-gray-700">Clique ou arraste seu documento</p>
                    <p className="text-sm text-gray-500 mt-1">Suporta JPG, PNG e PDF (Max 10MB)</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center space-y-4">
                  <div className="p-4 bg-green-100 rounded-full">
                    <CheckCircle className="w-8 h-8 text-green-600" />
                  </div>
                  <div>
                    <p className="text-lg font-medium text-gray-700">{file.name}</p>
                    <p className="text-sm text-gray-500 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                      setPreviewUrl(null);
                      setResult(null);
                    }}
                    className="text-sm text-red-500 hover:text-red-700 font-medium"
                  >
                    Remover arquivo
                  </button>
                </div>
              )}
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-700">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm">{error}</p>
              </div>
            )}

            <button
              onClick={processDocument}
              disabled={!file || isProcessing}
              className="w-full py-4 px-6 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl font-medium text-lg transition-colors flex items-center justify-center gap-2 shadow-sm"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Processando Documento...
                </>
              ) : (
                <>
                  Extrair Dados
                </>
              )}
            </button>

            {/* Preview Area */}
            {file && (
              <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                <h3 className="text-sm font-medium text-gray-500 mb-3 uppercase tracking-wider">Visualização</h3>
                {previewUrl ? (
                  <div className="relative aspect-[3/4] w-full max-h-[500px] overflow-hidden rounded-lg border border-gray-100 bg-gray-50">
                    <img src={previewUrl} alt="Preview" className="object-contain w-full h-full" referrerPolicy="no-referrer" />
                  </div>
                ) : (
                  <div className="aspect-[3/4] w-full max-h-[500px] flex flex-col items-center justify-center rounded-lg border border-gray-100 bg-gray-50 text-gray-400">
                    <FileIcon className="w-16 h-16 mb-4" />
                    <p>Visualização de PDF não disponível</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Results Section */}
          <div className="space-y-6">
             <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden h-full flex flex-col">
                <div className="p-6 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                    <Database className="w-5 h-5 text-gray-500" />
                    Dados Extraídos
                  </h2>
                  {result && !result.erro && (
                    <span className={
                      "px-3 py-1 text-xs font-medium rounded-full " +
                      (result.confianca_extracao === 'Alta' ? 'bg-green-100 text-green-800' : 
                        result.confianca_extracao === 'Média' ? 'bg-yellow-100 text-yellow-800' : 
                        'bg-red-100 text-red-800')
                    }>
                      Confiança: {result.confianca_extracao || 'N/A'}
                    </span>
                  )}
                </div>
                
                <div className="p-6 flex-1 overflow-auto bg-gray-50/50">
                  {!result && !isProcessing && (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-4 py-12">
                      <FileText className="w-12 h-12 opacity-20" />
                      <p className="text-center max-w-xs">Faça o upload de um documento e clique em "Extrair Dados" para ver o resultado aqui.</p>
                    </div>
                  )}

                  {isProcessing && (
                    <div className="h-full flex flex-col items-center justify-center text-blue-500 space-y-4 py-12">
                      <Loader2 className="w-12 h-12 animate-spin" />
                      <p className="font-medium animate-pulse">Analisando documento com IA...</p>
                    </div>
                  )}

                  {result && result.erro && (
                    <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-center space-y-3">
                      <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
                      <h3 className="text-lg font-medium text-red-800">Erro na Extração</h3>
                      <p className="text-red-600">
                        {result.erro === 'IMAGEM_ILEGIVEL' ? 'A imagem enviada está ilegível. Por favor, tente enviar uma foto mais nítida.' : 
                         result.erro === 'DOCUMENTO_INVALIDO' ? 'O arquivo enviado não parece ser uma nota fiscal ou recibo válido.' : 
                         result.erro}
                      </p>
                    </div>
                  )}

                  {result && !result.erro && (
                    <div className="space-y-6">
                      {/* Form-like display */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-gray-500 uppercase">Estabelecimento (Emissor)</label>
                          <div className="p-3 bg-white border border-gray-200 rounded-lg font-medium text-gray-900">
                            {result.estabelecimento || '-'}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-gray-500 uppercase">CNPJ</label>
                          <div className="p-3 bg-white border border-gray-200 rounded-lg font-mono text-sm text-gray-900">
                            {result.cnpj_emissor || '-'}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-gray-500 uppercase">Data de Emissão</label>
                          <div className="p-3 bg-white border border-gray-200 rounded-lg text-gray-900">
                            {result.data_emissao ? new Date(result.data_emissao).toLocaleDateString('pt-BR') : '-'}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-gray-500 uppercase">Valor Total</label>
                          <div className="p-3 bg-white border border-gray-200 rounded-lg font-bold text-green-700 text-lg">
                            {result.valor_total ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(result.valor_total) : '-'}
                          </div>
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <label className="text-xs font-medium text-gray-500 uppercase">Categoria Sugerida</label>
                          <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg font-medium text-blue-800">
                            {result.categoria_sugerida || '-'}
                          </div>
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <label className="text-xs font-medium text-gray-500 uppercase">Resumo dos Itens</label>
                          <div className="p-3 bg-white border border-gray-200 rounded-lg text-sm text-gray-700">
                            {result.itens_resumo || '-'}
                          </div>
                        </div>
                        {result.chave_acesso && (
                          <div className="space-y-1 md:col-span-2">
                            <label className="text-xs font-medium text-gray-500 uppercase">Chave de Acesso</label>
                            <div className="p-3 bg-white border border-gray-200 rounded-lg font-mono text-xs text-gray-600 break-all">
                              {result.chave_acesso}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Raw JSON */}
                      <div className="mt-8">
                        <h3 className="text-xs font-medium text-gray-500 uppercase mb-2">JSON Bruto (Para Firebase)</h3>
                        <pre className="p-4 bg-gray-900 text-gray-100 rounded-xl text-xs overflow-x-auto font-mono shadow-inner">
                          {JSON.stringify(result, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
             </div>
          </div>

        </main>
      </div>
    </div>
  );
}
