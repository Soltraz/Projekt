// src/Login.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { API, jPOST } from "./api";
import "./Login.css";
import symbol from "./assets/symbol_E_REVISIA.svg?url";


export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    try {
      const res = await jPOST<{ ok: boolean; user?: any; message?: string }>(
        `${API}/api/login`,
        { email, password }
      );

      if (!res.ok) {
        setError(res.message || "Login fehlgeschlagen");
        return;
      }

      // ganz simpel: merken, dass der User eingeloggt ist
      localStorage.setItem("revisia_auth", "1");
      nav("/dashboard");
    } catch (e: any) {
      setError("Serverfehler oder keine Verbindung");
    }
  }

    return (
    <div className="login-page">
        <div className="login-card">
        <img src={symbol} alt="REVISIA" className="login-logo" />
        <h1 className="login-title">Revisia Login</h1>
        <p className="login-subtitle">
            Bitte mit deinen Zugangsdaten anmelden
        </p>

        <form onSubmit={handleSubmit} className="login-form">
            <div className="login-field">
            <label className="login-label">E-Mail</label>
            <input
                type="email"
                className="login-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
            />
            </div>

            <div className="login-field">
            <label className="login-label">Passwort</label>
            <input
                type="password"
                className="login-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
            />
            </div>

            {error && (
            <div className="login-error">
                {error}
            </div>
            )}

            <button type="submit" className="login-button">
            Einloggen
            </button>
        </form>
        </div>
    </div>
    );
}
