export function generateOffers(baseApproval: any) {
  return [
    {
      bank: "LOCAL_SBA",
      program: "SBA 7(a)",
      rate: "WSJ + 2.75",
      max_amount: 450000,
      conditions: ["IRS transcript"]
    },
    {
      bank: "REGIONAL_BANK",
      program: "Conventional",
      rate: "Prime + 1.5",
      max_amount: 300000,
      conditions: ["Liquidity covenant"]
    }
  ];
}
