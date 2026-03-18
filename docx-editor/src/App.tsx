// src/App.tsx
import React from "react";
import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Workflow from "./workflow";
import Dashboard from "./Dashboard";
import CompanyPage from "./CompanyPage";
import Login from "./Login";

function RequireAuth({ children }: { children: ReactNode }) {
  const loggedIn = localStorage.getItem("revisia_auth") === "1";
  if (!loggedIn) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      {/* Login ist frei zugänglich */}
      <Route path="/login" element={<Login />} />

      {/* alles andere nur mit Login */}
      <Route
        path="/"
        element={<Navigate to="/dashboard" replace />}
      />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/companies/:id"
        element={
          <RequireAuth>
            <CompanyPage />
          </RequireAuth>
        }
      />
      <Route
        path="/workflow"
        element={
          <RequireAuth>
            <Workflow />
          </RequireAuth>
        }
      />
      <Route
        path="*"
        element={<Navigate to="/dashboard" replace />}
      />
    </Routes>
  );
}
