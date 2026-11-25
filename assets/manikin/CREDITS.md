# Credits: the manikin

Everything third-party in the manikin packages under `assets/manikin/` (the dressed operator `operator-m`,
`operator-f`; the clay figure `clay-m`, `clay-f`; the motion clips `clips/`; the shared maps `shared/`), with its
licence. Each package's `PROVENANCE.json` lists the same sources per package, with the checksums of the files they
became. Licences were read on each asset's own file header and pack metadata in the avatar lab (2026-11-24) and are
not legal advice.

## Must be credited wherever the dressed operator is shown (CC BY 4.0)

The work shirt and the work trousers of both dressed packages are community garments under the Creative Commons
Attribution 4.0 licence (<https://creativecommons.org/licenses/by/4.0/>). Credit them in the viewer wherever the
dressed operator is shown, and on the credits page, for example:

> Work shirt: "Male shirt untucked BD1" by Elvaerwyn. Work trousers: "Male trousers 2" by Mindfront. Both from the
> MakeHuman community asset packs (makehumancommunity.org), CC BY 4.0; re-fitted to every body shape, edges given
> thickness, textures reduced to a neutral detail map and re-coloured, folds baked by the project.

| Part | Title | Author | Source | Licence | Changes |
|---|---|---|---|---|---|
| Work shirt (both sexes) | Male shirt untucked BD1 | Elvaerwyn | MakeHuman community asset pack shirts02 (CC-BY), <http://www.makehumancommunity.org> | CC-BY-4.0 | re-fitted to the body shapes; refined once over the chest; edge thickness, buttons, seams and pockets added; neutral detail map, re-coloured; standing folds baked by an offline cloth run |
| Work trousers (both sexes) | Male trousers 2 | Mindfront | MakeHuman community asset pack pants02 (CC-BY), <http://www.makehumancommunity.org> | CC-BY-4.0 | re-fitted to the body shapes; edge thickness added; neutral detail map, re-coloured; seated folds as pose correctives from an offline cloth drape |

## Motion capture (CMU Graphics Lab terms)

The motion clips (`clips/m/`, `clips/f/`: walk, sit down and get up, seated base, range of motion, idle and operating
clips, baked per body) are retargeted from the CMU Graphics Lab Motion Capture Database, <http://mocap.cs.cmu.edu/>
(subjects 07, 79, 86 and 143: takes 07_01, 79_22, 79_76, 79_85, 86_15, 143_18, 143_21). Its terms, as read on the site on 2026-11-24: free for research; the data may be
included in commercially sold products, but not resold directly, even in converted form. The site asks for this
credit line, which the credits page should carry:

> The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF
> EIA-0196217.

## Open licences of the rest (no credit required; credited here)

| Part | Title | Author | Source | Licence |
|---|---|---|---|---|
| Body mesh, UVs, shape targets, rig, painted weights | MakeHuman hm08 base (MPFB2 2.0.18 data) | MakeHuman team | <https://github.com/makehumancommunity/mpfb2> | CC0-1.0 |
| Skin albedo, light tone | young_lightskinned_male_diffuse, young_lightskinned_female_diffuse | MakeHuman team | MakeHuman system assets | CC0-1.0 |
| Skin albedo, medium tone | harvey_midtoned_female_diffuse | callharvey3d | MakeHuman community asset pack skins01 | CC0-1.0 |
| Skin albedo, dark tone | young_darkskinned_male_diffuse, young_darkskinned_female_diffuse | MakeHuman team | MakeHuman system assets | CC0-1.0 |
| Skin roughness zones | Aksel skin (specular map) | Mindfront | MakeHuman community asset pack skins02 | CC0-1.0 |
| Brows (painted into the skin), hairline shape | eyebrow001, short04 | MakeHuman team | MakeHuman system assets | CC0-1.0 |
| Work cap (mesh only; its slogan texture is not used) | Cap (mesh) | toigo | MakeHuman community asset pack hats01 | CC0-1.0 |
| Safety glasses | Sagerfrog's glasses 03 | spamrakuen | MakeHuman community asset pack glasses01 | CC0-1.0 |
| Fabric weave detail maps (`shared/maps/`) | denim_fabric_04, rough_linen (normal, 1k) | Poly Haven | <https://polyhaven.com/license> | CC0-1.0 |
| Shape space (fitted to the ANSUR II survey; no survey data in any package) | | the project, on Anny 0.6.2 (NAVER LABS Europe) | <https://github.com/naver/anny> | Anny: Apache-2.0 code, CC0-1.0 data; the fit: the project's own work |
| Eyes, lids, tear line, iris structure; game-style rig, twist and helper joints, skin weights, correctives; headset, collar band, safety trainer, shoe last; the women's hair under the cap; the clay figure's style; retargeting and baking of the clips | | the project | built in the avatar lab (`tools/manikin-build/`) | the project's own work, under the repository's licence |

## Tools used to build and pack (not part of the packages)

Blender 5.2.4 (GPL-3.0-or-later, build tool only), MPFB2 2.0.18 (GPL-3.0-or-later code, used as a data source),
Python with numpy, scipy and PyTorch, glTF-Transform 4.5.1 and meshoptimizer 1.1.1 (MIT), KTX-Software 4.4.2 toktx
(Apache-2.0). Their output is not covered by their licences.

Nothing from the SMPL family of body models, from MetaHuman, or from any commercial library is in the manikin.
