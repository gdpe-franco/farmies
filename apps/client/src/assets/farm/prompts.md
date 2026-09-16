# Farmies scene asset prompts

Generated with the built-in imagegen tool. The supplied Farmies MVP sheet was used only as a visual reference. These are prototype game assets, not polished final art.

## pasture.png

Use case: stylized-concept
Asset type: production 2D game pasture background PNG, landscape 1536x1024.
Input image: supplied Farmies MVP sheet is a STYLE REFERENCE ONLY, not an edit target.
Create an original cozy softly pixelated countryside pasture matching the reference mood, with chunky rounded trees, muted rolling sage hills, almond dirt path curling gently from the lower left toward a tiny distant barn at upper right, a low wooden fence in the middle distance, sparse grass tufts, bushes at the lower corners. Warm cream sky occupies top quarter; broad open grassy playable area fills the lower two thirds, especially center and right, with very little clutter so ten cow sprites can be overlaid.
Medium: beautiful restrained low-resolution game pixel art, readable pixel clusters and lightly stepped edges, no smooth airbrushed rendering, no excessive tiny detail. Handcrafted quiet storybook feel.
Palette: muted teal #94a89a, almond silk #c9b7ad, grey #797d81, thistle #cab1bd, powder blush #efb0a1, warm cream #f3eee9, outlines deep muted green #24332a. Use shaded companions, avoid saturated green.
No cows, no people, no interface panels, no borders, no headings, no labels, no text, no logos or watermark. Full bleed game background, usable directly by PixiJS.

## cow-atlas.png

Current revision: built-in imagegen minimal recolor edit of the pixel cow atlas. Selected output: `exec-d32da96e-852f-4965-a50c-0ad01033eb75.png`. Pasture unchanged.

Final revision prompt:

Use case: precise-object-edit. Edit this exact game cow atlas. Change ONLY the dark green/teal cow markings, outlines, horns, hooves and tails to dark neutral charcoal-grey, a darker companion of Farmies Grey #797d81: main patches #45474b, outline #34363a, highlights #606369. No green or teal anywhere in the cows. Keep cream coat, almond shading and powder blush #efb0a1 ears/udder unchanged. Preserve EXACT four-by-four equal square cell layout, all sixteen cow silhouettes, anatomy, blank cream heads, head positions, proportions, pixel-cluster art, tail movement, walking/grazing/sleeping poses and alignment. Do not alter scale or spacing. Clean any stray isolated pixels outside each cow; every cow outline must remain intact and all parts contained in their respective cells with clear empty margins. Genuine transparent background preferred; do not add scenery, lettering or additional elements. This is a minimal recolor of an existing runtime spritesheet, not a redesign.

Runtime preparation also retains only each frame's connected cow silhouette, removing isolated matte pixels and neighboring-frame fragments. Both photos and pixel-feature placeholders use the same exact head mask.

### Pixel-style revision prompt

Use case: style-transfer. Image 1 is the cow animation atlas edit target. Image 2 is ONLY the pixel-art style and palette reference; do not change or reproduce the pasture. Replace image 1 with a production 4x4 cow sprite atlas, square, sixteen equal cells. Keep exactly the original pose layout: row1 idle four frames, row2 walking four frames, row3 grazing four frames, row4 sleeping four frames. Preserve cow size, head positions, rounded proportions and blank large cream face areas without eyes/mouth; cream blank head must be enclosed by a continuous dark sage outline in every frame. Match image2's genuine stepped pixel-cluster edges, flat limited cream/sage/dark teal/blush colors and restrained pixel shading. NO smooth vector lines, no antialiasing, no gradients. Big heads reaching ears, black-green coat spots, little hooves and horns. Each cow isolated entirely in its equal cell, no text or gridlines, no shadows connected to outlines. Background genuinely transparent; if alpha unavailable use pure white neutral background. Keep all four frames of each pose aligned and stable with only legs/tail/subtle movement changing.

The generated RGB output still contains a neutral checkerboard. Runtime preparation removes its edge-connected matte and extracts enclosed cream-head masks; private photos cover those exact head pixels, leaving the ears/outline intact.

### Original prompt (superseded cow art)

Use case: stylized-concept
Asset type: game animation sprite sheet PNG with genuinely TRANSPARENT alpha background, exact 1024x1024 square.
Reference image is the supplied Farmies style sheet only.
Produce exactly sixteen sprites in a strict invisible 4-column x 4-row grid. Each cell is exactly 256x256; no grid lines. A consistent original cute rounded cow faces LEFT in every cell, full body shown, white warm-cream coat, charcoal green patches and hooves, tiny horns, small blush udder, short swishing tail, soft pixel art with clear pixel clusters in a restrained storybook style.
Cow drawn at the SAME SCALE and placed in each cell with body centered x=145 y=146, ground baseline y=212, every part stays between x=24..232 and y=52..220. Head has a large EMPTY CREAM face area with no eyes, nose, mouth or markings; our app inserts a private selfie there.
ROW 1 cells 1–4: standing idle loop, subtle breathing and ear/tail changes, upright head center x=62 y=116, oval blank face about 52 wide x62 high.
ROW 2 cells 1–4: four distinct frames of a WALK cycle, alternating legs lifted forward/back, body position stable, upright head center x=62 y=116 remains stable.
ROW 3 cells 1–4: GRAZING loop, head lowered to center x=62 y=178, subtle chew and ear changes, four distinct frames, no grass included.
ROW 4 cells 1–4: SLEEPING loop curled resting with folded legs, head center x=62 y=160, tiny breathing changes, no Z symbols.
Keep identical anatomy, patch patterns and lighting across all sixteen sprites. No humans, no baked photo, no text, no labels, no numbers, no borders, no scenery, no shadows outside each cell, no watermark. Palette: cream #f3eee9, dark green #24332a, grey #797d81, almond #c9b7ad, blush #efb0a1; gentle muted shading. Actual transparent background, not checkerboard painted into pixels. This is a directly consumed runtime atlas; equal cell spacing and exact 4x4 count are mandatory.
