export const API_BASE =
    (import.meta as any).env?.VITE_API_BASE?.replace(/\/$/, "") ||
    "http://localhost:8001";
