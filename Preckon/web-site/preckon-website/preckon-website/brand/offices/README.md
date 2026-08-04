# Office photographs

Four images, one per card in the Offices section of `preckon-demo.html`.

| File | City |
|---|---|
| `austin.jpg` | Austin, Texas |
| `mississauga.jpg` | Mississauga, Ontario |
| `hyderabad.jpg` | Hyderabad, Telangana |
| `dubai.jpg` | Dubai, UAE |

**Spec:** 1600 × 1000 px (16:10 — the card reserves that ratio, so anything else
is cropped centrally), JPEG, quality ~80, ideally under 250 KB each. They are
lazy-loaded and sit below the fold, so weight matters less than sharpness at
2× on a laptop screen.

**Licensing.** Use a photo you own, one your team shot, or a properly licensed
stock image. A city photo pulled from search results is somebody's copyrighted
work, and a contact page is exactly where a rights holder looks. Unsplash and
Pexels are free for commercial use; Shutterstock and Getty need a licence.

**Until they exist** each card shows its `.svg` illustration — original artwork
drawn for this site, so there is no rights holder to answer to. The SVG is a CSS
background behind the `<img>`; adding `austin.jpg` (etc.) covers it with no
markup change, and removing the JPEG falls back to the drawing again.

Keep the SVGs even after adding photos — they are the fallback if an image ever
404s, and they carry the brand colours.
