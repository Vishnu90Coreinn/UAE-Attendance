# PDF reporting dependencies

The owner requested a free PDF alternative on 2026-10-20 and confirmed the English prototype scope, excluding Arabic reporting. S4 replaces QuestPDF with **PdfPig 0.1.16**. Reports are generated locally; no external PDF service receives payroll data.

## PdfPig

- Licence: Apache License 2.0, permitting commercial use without a revenue-based subscription tier.
- Package: https://www.nuget.org/packages/PdfPig/0.1.16
- Official project/documentation: https://uglytoad.github.io/PdfPig/
- Source and licence: https://github.com/UglyToad/PdfPig
- The full licence is retained with the API PDF assets and included in build/publish output.

## Noto Sans

- Embedded unmodified Regular and Bold fonts provide consistent PDF output without installed system-font dependencies.
- Licence: SIL Open Font License 1.1.
- Source: https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoSans
- The full font licence is retained at `apps/api/Pdf/Fonts/LICENSE` and included in build/publish output.

## Selection rationale

QuestPDF Community eligibility was not assumed. The owner preferred a free alternative to resolving the client's revenue-based eligibility: https://www.questpdf.com/license/guide.html

PDFsharp/MigraDoc 6.2.4 was MIT, but current 6.5/7.0 releases use AGPL/commercial licensing, and the publisher states 6.2 receives no further updates. This project does not depend on that discontinued line: https://www.pdfsharp.com/Pricing and https://www.pdfsharp.com/

The owner explicitly excluded Arabic/complex-script display because the supplied prototype is English. PdfPig is therefore used for the required English report. Unsupported glyphs receive a controlled client error instead of an unexpected server failure; no worker-table validation or schema restriction is added.

Review package licences and vulnerability reports when upgrading. The application requires no browser installation, paid PDF licence key, evaluation watermark or trial configuration.
