export default function StitchLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style
         
        dangerouslySetInnerHTML={{
          __html: `
/* ✅ Force stitch segment to appear "light" even if the app root is dark */
html { color-scheme: light; }
body { background: #ffffff !important; color: #0f172a !important; }

/* Keep the embed predictable */
.stitch-embed { background: #ffffff; color: #0f172a; color-scheme: light; }
          `.trim(),
        }}
      />
      {children}
    </>
  );
}
