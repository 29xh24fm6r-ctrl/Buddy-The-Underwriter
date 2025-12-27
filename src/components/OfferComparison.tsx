export function OfferComparison({ offers }: { offers: any[] }) {
  return (
    <div className="border p-4 rounded">
      <h3 className="font-semibold">Available Offers</h3>
      <ul>
        {offers.map(o => (
          <li key={o.bank}>
            {o.bank} — {o.program} — {o.rate}
          </li>
        ))}
      </ul>
    </div>
  );
}
