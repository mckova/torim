import { createContext, useContext } from "react";
import { Business, Provider, Service, createApi } from "@torim/shared";

const KEY = "torim.pro.token";
export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));
export const api = createApi(getToken);

export interface Me {
  me: Provider & { email: string };
  business: Business;
  providers: Provider[];
  services: Service[];
}

export const MeContext = createContext<{ data: Me; reload: () => void } | null>(null);
export function useMe() {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("MeContext missing");
  return ctx;
}
