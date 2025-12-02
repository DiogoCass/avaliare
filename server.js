// ============================================
// SERVIDOR NODE.JS - AVALIARE
// ============================================
// Este arquivo é o backend seguro do sistema.
// Todas as credenciais ficam aqui no servidor,
// protegidas do acesso público.
// ============================================

const http = require("http")
const fs = require("fs")
const path = require("path")

// ============================================
// FIREBASE ADMIN SDK
// ============================================
// Usamos o Firebase Admin SDK para acessar o banco
// de dados de forma segura, sem expor as credenciais.
// ============================================

const admin = require("firebase-admin")

// Carrega as credenciais do arquivo .env ou variáveis de ambiente
// Em produção, use variáveis de ambiente do seu serviço de hospedagem
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CERT_URL,
}

// Inicializa o Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

// Referência ao Firestore (banco de dados)
const db = admin.firestore()

// ============================================
// SENHAS SEGURAS (VARIÁVEIS DE AMBIENTE)
// ============================================
// Essas senhas agora ficam no servidor, não no front-end!
// ============================================

const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL || "developerdiogo@gmail.com"

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

// Função para enviar resposta JSON
function sendJSON(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(data))
}

// Função para ler o corpo da requisição POST
function getBody(req) {
  return new Promise((resolve, reject) => {
    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"))
      } catch (e) {
        resolve({})
      }
    })
    req.on("error", reject)
  })
}

// Função para servir arquivos estáticos
function serveStatic(res, filePath) {
  const ext = path.extname(filePath)
  const contentTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end("Arquivo não encontrado")
      return
    }
    res.writeHead(200, { "Content-Type": contentTypes[ext] || "text/plain" })
    res.end(data)
  })
}

// ============================================
// ROTAS DA API
// ============================================
// Aqui definimos todas as operações do sistema.
// O front-end chama essas rotas via fetch().
// ============================================

const apiRoutes = {
  // LOGIN - Verifica a senha do usuário
  async login(body) {
    const { companyId, password } = body
    if (!companyId || !password) {
      return { success: false, error: "Campos obrigatórios" }
    }
    // Verifica se a senha está correta
    if (password === LOGIN_PASSWORD) {
      return { success: true }
    }
    return { success: false, error: "Senha incorreta" }
  },

  // VERIFICA ADMIN - Verifica a senha de administrador
  async verifyAdmin(body) {
    const { password } = body
    if (password === ADMIN_PASSWORD) {
      return { success: true }
    }
    return { success: false, error: "Senha incorreta" }
  },

  // PERFIL DA EMPRESA - Busca o perfil
  async getCompanyProfile(body) {
    const { companyId } = body
    try {
      const doc = await db.collection("company_profiles").doc(companyId).get()
      if (doc.exists) {
        return doc.data()
      }
      return { name: "", description: "", avatarUrl: "https://via.placeholder.com/120" }
    } catch (err) {
      return { name: "", description: "", avatarUrl: "https://via.placeholder.com/120" }
    }
  },

  // PERFIL DA EMPRESA - Salva o perfil
  async saveCompanyProfile(body) {
    const { companyId, profileData } = body
    try {
      await db.collection("company_profiles").doc(companyId).set(profileData)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  },

  // PESQUISAS - Lista todas as pesquisas de uma empresa
  async getSurveys(body) {
    const { companyId } = body
    try {
      const snapshot = await db.collection(`surveys_${companyId}`).orderBy("created", "desc").get()

      const surveys = []
      snapshot.forEach((doc) => {
        surveys.push({ id: doc.id, ...doc.data() })
      })
      return surveys
    } catch (err) {
      return []
    }
  },

  // PESQUISA - Busca uma pesquisa específica
  async getSurvey(body) {
    const { companyId, surveyId } = body
    try {
      const doc = await db.collection(`surveys_${companyId}`).doc(surveyId).get()
      if (doc.exists) {
        return { id: doc.id, ...doc.data() }
      }
      return null
    } catch (err) {
      return null
    }
  },

  // PESQUISA - Salva ou atualiza uma pesquisa
  async saveSurvey(body) {
    const { companyId, surveyId, data } = body
    try {
      const colRef = db.collection(`surveys_${companyId}`)
      if (surveyId) {
        // Atualiza pesquisa existente
        await colRef.doc(surveyId).set(data)
      } else {
        // Cria nova pesquisa
        await colRef.add(data)
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  },

  // PESQUISA - Deleta uma pesquisa
  async deleteSurvey(body) {
    const { companyId, surveyId } = body
    try {
      // Primeiro deleta todas as respostas
      const responsesRef = db.collection(`surveys_${companyId}/${surveyId}/responses`)
      const responsesSnapshot = await responsesRef.get()

      const batch = db.batch()
      responsesSnapshot.forEach((doc) => batch.delete(doc.ref))
      await batch.commit()

      // Depois deleta a pesquisa
      await db.collection(`surveys_${companyId}`).doc(surveyId).delete()
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  },

  // RESPOSTAS - Busca todas as respostas de uma pesquisa
  async getResponses(body) {
    const { companyId, surveyId } = body
    try {
      const snapshot = await db.collection(`surveys_${companyId}/${surveyId}/responses`).get()
      const responses = []
      snapshot.forEach((doc) => responses.push(doc.data()))
      return responses
    } catch (err) {
      return []
    }
  },

  // RESPOSTAS - Envia uma nova resposta
  async submitResponse(body) {
    const { companyId, surveyId, data } = body
    try {
      await db.collection(`surveys_${companyId}/${surveyId}/responses`).add(data)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  },

  // NOTIFICAÇÃO - Envia email de notificação
  async sendNotification(body) {
    const { email, surveyTitle, responseCount } = body
    try {
      // Envia para o Google Apps Script (mantém a mesma lógica)
      const message =
        responseCount === 1
          ? `Um cliente respondeu sua pesquisa "${surveyTitle}"`
          : `${responseCount} clientes responderam sua pesquisa "${surveyTitle}"`

      await fetch(
        "https://script.google.com/macros/s/AKfycbwdRKtuClt7BBs4IeMUTQ4WTSO6f7-R49NiZbU3VPaol0-YsIs4ajIHcZKJUlDqk1zm/exec",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: email,
            from: NOTIFICATION_EMAIL,
            subject: `Avaliare - Nova(s) Resposta(s) em ${surveyTitle}`,
            message: message,
            surveyTitle: surveyTitle,
            responseCount: responseCount,
          }),
        },
      )
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  },

  // USUÁRIO - Deleta completamente um usuário e seus dados
  async deleteUser(body) {
    const { companyId } = body
    try {
      // Lista todas as pesquisas do usuário
      const surveysRef = db.collection(`surveys_${companyId}`)
      const surveysSnapshot = await surveysRef.get()

      // Deleta todas as respostas de cada pesquisa
      for (const surveyDoc of surveysSnapshot.docs) {
        const responsesRef = db.collection(`surveys_${companyId}/${surveyDoc.id}/responses`)
        const responsesSnapshot = await responsesRef.get()

        const batch = db.batch()
        responsesSnapshot.forEach((doc) => batch.delete(doc.ref))
        await batch.commit()

        // Deleta a pesquisa
        await surveyDoc.ref.delete()
      }

      // Deleta o perfil da empresa
      await db.collection("company_profiles").doc(companyId).delete()

      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  },
}

// ============================================
// SERVIDOR HTTP
// ============================================

const PORT = process.env.PORT || 3000

const server = http.createServer(async (req, res) => {
  // Configuração de CORS para permitir requisições
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  // Responde OPTIONS para preflight requests
  if (req.method === "OPTIONS") {
    res.writeHead(200)
    res.end()
    return
  }

  const url = req.url

  // ============================================
  // ROTAS DA API
  // ============================================
  if (url.startsWith("/api/") && req.method === "POST") {
    const endpoint = url.replace("/api/", "")
    const handler = apiRoutes[endpoint]

    if (handler) {
      try {
        const body = await getBody(req)
        const result = await handler(body)
        sendJSON(res, result)
      } catch (err) {
        sendJSON(res, { error: err.message }, 500)
      }
    } else {
      sendJSON(res, { error: "Endpoint não encontrado" }, 404)
    }
    return
  }

  // ============================================
  // ARQUIVOS ESTÁTICOS
  // ============================================
  // Serve o index.html e outros arquivos da pasta public

  let filePath = url === "/" ? "/index.html" : url
  filePath = path.join(__dirname, "public", filePath)

  // Verifica se o arquivo existe
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    serveStatic(res, filePath)
  } else {
    // Se não existir, serve o index.html (para SPAs)
    serveStatic(res, path.join(__dirname, "public", "index.html"))
  }
})

server.listen(PORT, () => {
  console.log(`
============================================
🚀 SERVIDOR AVALIARE RODANDO!
============================================
📍 URL: http://localhost:${PORT}
📁 Pasta pública: ./public
🔐 Credenciais protegidas no servidor
============================================
  `)
})
