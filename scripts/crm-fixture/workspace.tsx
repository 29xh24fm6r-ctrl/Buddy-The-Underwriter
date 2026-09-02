// Isolated layout fixture: no customer data, authentication, or network calls.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrokerageShell } from "../../src/components/brokerage/BrokerageShell";
import { Location } from "./navigation";

window.fetch = async () => { throw new Error("Network disabled in workspace fixture"); };
function Fixture() {
  const [pathname, navigate] = useState("/admin/brokerage");
  return <Location.Provider value={{ pathname, search: "", navigate }}>
    <BrokerageShell><p style={{ padding: 24 }}>Offline layout check. Selected destination: {pathname}. Operational page content is not modeled.</p></BrokerageShell>
  </Location.Provider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
