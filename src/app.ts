import express, { Request, Response } from "express";
import session from "express-session";
import bcrypt from "bcrypt";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { body, validationResult } from "express-validator";
import { readFileSync, writeFileSync } from "fs";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

const sessionSecret = process.env.SESSION_SECRET || "Use_a_strong_secret_in_production";
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  })
);

app.set("view engine", "ejs");
app.set("views", "./src/views");
app.use(express.static("public"));

type User = { id: number; nome: string; email: string; senha: string; role: "user" | "admin" };
type Comentario = { id: number; userId: number; autor: string; texto: string; data: string };

function carregarUsers(): User[] {
  try {
    return JSON.parse(readFileSync("dados/usuarios.json", "utf-8")) as User[];
  } catch {
    return [];
  }
}

function salvarUsers(users: User[]) {
  writeFileSync("dados/usuarios.json", JSON.stringify(users, null, 2));
}

function carregarComentarios(): Comentario[] {
  try {
    return JSON.parse(readFileSync("dados/comentarios.json", "utf-8")) as Comentario[];
  } catch {
    return [];
  }
}

function salvarComentarios(comentarios: Comentario[]) {
  writeFileSync("dados/comentarios.json", JSON.stringify(comentarios, null, 2));
}

function encontrarUsuarioPorEmail(email: string): User | undefined {
  return carregarUsers().find((u) => u.email.toLowerCase() === email.toLowerCase());
}

async function verifyPassword(user: User, senha: string): Promise<boolean> {
  const password = String(senha);
  if (user.senha.startsWith("$2")) {
    return bcrypt.compare(password, user.senha);
  }
  return user.senha === password;
}

async function hashPassword(senha: string) {
  return bcrypt.hash(String(senha), 12);
}

app.get("/login", (req, res) => {
  const flash = req.session.flash || null;
  req.session.flash = null;
  res.render("login", { flash });
});

app.post("/login", async (req, res) => {
  const { email, senha } = req.body as { email: string; senha: string };
  const users = carregarUsers();
  const user = users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user || !(await verifyPassword(user, senha))) {
    req.session.flash = "Email ou senha incorretos.";
    res.redirect("/login");
    return;
  }

  if (!user.senha.startsWith("$2")) {
    user.senha = await hashPassword(senha);
    salvarUsers(users);
  }

  req.session.userId = user.id;
  req.session.userName = user.nome;
  req.session.userRole = user.role;
  res.redirect("/");
});

app.get("/registro", (req, res) => {
  res.render("registro", { flash: null });
});

app.post(
  "/registro",
  body("nome").trim().notEmpty().withMessage("Nome é obrigatório."),
  body("email").trim().isEmail().withMessage("Email inválido.").normalizeEmail(),
  body("senha").isLength({ min: 8 }).withMessage("Senha deve ter no mínimo 8 caracteres."),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.session.flash = errors.array()[0].msg;
      res.redirect("/registro");
      return;
    }

    const { nome, email, senha } = req.body as { nome: string; email: string; senha: string };
    const users = carregarUsers();
    if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      req.session.flash = "Email já cadastrado.";
      res.redirect("/registro");
      return;
    }

    users.push({
      id: users.length + 1,
      nome: String(nome).trim(),
      email: String(email).toLowerCase(),
      senha: await hashPassword(senha),
      role: "user",
    });
    salvarUsers(users);

    req.session.flash = "Conta criada! Faça login.";
    res.redirect("/login");
  }
);

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/", (req, res) => {
  if (!req.session.userId) {
    res.redirect("/login");
    return;
  }

  const comentarios = carregarComentarios();
  const flash = req.session.flash || null;
  req.session.flash = null;
  res.render("home", {
    nome: req.session.userName,
    role: req.session.userRole,
    comentarios,
    flash,
  });
});

app.post(
  "/comentar",
  body("texto").trim().isLength({ min: 1, max: 500 }).withMessage("Comentário inválido."),
  (req, res) => {
    if (!req.session.userId) {
      res.redirect("/login");
      return;
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.session.flash = errors.array()[0].msg;
      res.redirect("/");
      return;
    }

    const coments = carregarComentarios();
    coments.push({
      id: coments.length + 1,
      userId: req.session.userId,
      autor: req.session.userName || "",
      texto: String(req.body.texto),
      data: new Date().toLocaleDateString("pt-BR"),
    });
    salvarComentarios(coments);
    res.redirect("/");
  }
);

app.post("/comentarios/:id/editar", (req, res) => {
  if (!req.session.userId) {
    res.redirect("/login");
    return;
  }

  const coments = carregarComentarios();
  const comentario = coments.find((comment) => comment.id === Number(req.params.id));
  if (
    comentario &&
    (comentario.userId === req.session.userId || req.session.userRole === "admin")
  ) {
    comentario.texto = String(req.body.texto);
    salvarComentarios(coments);
  }

  res.redirect("/");
});

app.post("/comentarios/:id/remover", (req, res) => {
  if (!req.session.userId) {
    res.redirect("/login");
    return;
  }

  const coments = carregarComentarios();
  const commentIndex = coments.findIndex((comment) => comment.id === Number(req.params.id));
  if (commentIndex !== -1) {
    const comment = coments[commentIndex];
    if (comment.userId === req.session.userId || req.session.userRole === "admin") {
      coments.splice(commentIndex, 1);
      salvarComentarios(coments);
    }
  }

  res.redirect("/");
});

app.get("/api/usuarios", (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.session.userRole !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const users = carregarUsers().map(({ senha, ...user }) => user);
  res.json(users);
});

app.get("/admin", (req, res) => {
  if (!req.session.userId) {
    res.redirect("/login");
    return;
  }
  if (req.session.userRole !== "admin") {
    res.status(403).redirect("/");
    return;
  }

  res.render("admin", { usuarios: carregarUsers(), flash: null });
});

app.listen(3000, () => console.log("App rodando em http://localhost:3000"));
