# Overlay Diagnostic Script for Vercel

## Run these in Browser DevTools Console on the broken page

### 1. Find what's under the mouse cursor
```javascript
(() => {
  const el = document.elementFromPoint(window.innerWidth/2, window.innerHeight/2);
  console.log("Element under cursor:", el);
  console.log("Tag:", el?.tagName);
  console.log("Classes:", el?.className);
  console.log("ID:", el?.id);
  console.log("Computed style:");
  if (el) {
    const s = getComputedStyle(el);
    console.log("  position:", s.position);
    console.log("  z-index:", s.zIndex);
    console.log("  pointer-events:", s.pointerEvents);
    console.log("  width x height:", s.width, "x", s.height);
  }
  return el;
})()
```

### 2. Find all full-screen fixed overlays
```javascript
(() => {
  const overlays = [...document.querySelectorAll("body *")].filter(el => {
    const s = getComputedStyle(el);
    if (s.position !== "fixed") return false;
    const r = el.getBoundingClientRect();
    return r.width > window.innerWidth * 0.8 && 
           r.height > window.innerHeight * 0.8 && 
           s.pointerEvents !== "none";
  });
  console.log("Found", overlays.length, "full-screen fixed overlays WITHOUT pointer-events-none:");
  overlays.forEach((el, i) => {
    console.log(`[${i}]`, {
      tag: el.tagName,
      id: el.id,
      classes: el.className,
      zIndex: getComputedStyle(el).zIndex,
      pointerEvents: getComputedStyle(el).pointerEvents
    });
    // Highlight first 5
    if (i < 5) el.style.outline = "3px solid red";
  });
  return overlays;
})()
```

### 3. Check pointer-events chain from a button
```javascript
(() => {
  // First, click on a button in Elements panel, then run this
  let el = window.$0 || document.querySelector("button") || document.querySelector("a");
  if (!el) {
    console.log("No element selected. Click a button in Elements panel first.");
    return;
  }
  
  console.log("Checking pointer-events chain for:", el);
  const chain = [];
  while (el) {
    const s = getComputedStyle(el);
    chain.push({
      tag: el.tagName,
      id: el.id || "(no id)",
      class: el.className?.substring?.(0, 50) || "(no class)",
      pointerEvents: s.pointerEvents,
      position: s.position,
      zIndex: s.zIndex,
    });
    if (s.pointerEvents === "none") {
      console.warn("❌ BLOCKED at:", el);
      break;
    }
    el = el.parentElement;
  }
  console.table(chain);
  return chain;
})()
```

### 4. BRUTE FORCE FIX (temporary diagnostic)
```javascript
// This will disable pointer-events on all big fixed overlays
// If buttons start working after this, we KNOW it's an overlay issue
(() => {
  let count = 0;
  [...document.querySelectorAll("*")].forEach(el => {
    const s = getComputedStyle(el);
    if (s.position === "fixed" && s.pointerEvents !== "none") {
      const r = el.getBoundingClientRect();
      if (r.width > innerWidth*0.8 && r.height > innerHeight*0.8) {
        console.log("Disabling pointer-events on:", el);
        el.style.pointerEvents = "none";
        count++;
      }
    }
  });
  console.log(`✅ Disabled ${count} overlays. Try clicking buttons now.`);
})()
```

## What to look for

### If it's an overlay:
- Script #2 will find it and outline it in RED
- You'll see a `div` with:
  - `position: fixed`
  - Large width/height (near 100vw/100vh)
  - `z-index` > 40
  - `pointer-events: auto` or not set

### Common culprits:
- Class names containing: `backdrop`, `overlay`, `modal`, `dialog`, `sheet`, `drawer`
- Components: FrameGuard, Dialog, CommandPalette, Loading veil
- Stitch remnants with embedded overlays

## Next Steps

After running scripts, paste the output here with:
1. What script #2 found (overlay count + classes)
2. What script #4 did (did buttons start working?)
3. Screenshot of red-outlined overlays

With that, I'll give you the exact file + line number to fix.
