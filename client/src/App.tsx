import { useEffect, useState } from "react";
import { Home } from "./pages/Home";
import type { Account, VendorInfo } from "./types";
import { api } from "./utils/api";

const MIDEA: VendorInfo = {
  id: "midea",
  name: "美的美居",
  authModes: ["sms", "password"],
  regions: [{ id: "cn", name: "中国" }],
};

const FALLBACK_VENDORS: VendorInfo[] = [
  {
    id: "xiaomi",
    name: "小米 / 米家",
    authModes: ["password", "qr"],
    regions: [{ id: "cn", name: "中国" }],
  },
  MIDEA,
];

function withMidea(list: VendorInfo[]) {
  if (list.some((item) => item.id === "midea")) return list;
  const next = [...list];
  const xiaomi = next.findIndex((item) => item.id === "xiaomi");
  next.splice(xiaomi >= 0 ? xiaomi + 1 : next.length, 0, MIDEA);
  return next;
}

export function App() {
  const [vendors, setVendors] = useState<VendorInfo[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const data = await api<{ vendors: VendorInfo[] }>("/api/vendors");
        if (!stop) setVendors(withMidea(data.vendors.length ? data.vendors : FALLBACK_VENDORS));
      } catch {
        if (!stop) setVendors(withMidea(FALLBACK_VENDORS));
      }
      try {
        const me = await api<{ accounts: Account[] }>("/api/me");
        if (!stop) setAccounts(me.accounts || []);
      } catch {
        if (!stop) setAccounts([]);
      } finally {
        if (!stop) setReady(true);
      }
    })();
    return () => {
      stop = true;
    };
  }, []);

  if (!ready) return null;
  return <Home accounts={accounts} vendors={vendors} onAccounts={setAccounts} />;
}
