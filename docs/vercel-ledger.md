| Sat Dec 27 23:45:42 UTC 2025 | auth | Google sign-in button no-op on Vercel | /sign-in | click does nothing | identify auth stack; fix env + callback URLs |
| Sat Dec 27 23:54:43 UTC 2025 | ui | Material icons rendering as text + double chrome | /deals | icon ligatures broken, layout conflict | load Material Symbols font, fix layout groups |
| Sun Dec 28 00:03:25 UTC 2025 | docs | Documents route blank (chrome only) | /documents | page body empty | locate route + detect runtime crash + add error boundary + fix data deps |
| Sun Dec 28 00:06:47 UTC 2025 | ui | All UI non-interactive (overlay blocking) | /documents,/deals | buttons don't click, drag/drop dead | find + remove fixed overlay, fix pointer-events |
