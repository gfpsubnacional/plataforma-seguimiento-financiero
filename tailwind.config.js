/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./app.jsx", "./FinancialComparator.jsx", "./src/**/*.jsx"],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui"] },
      colors: {
        inst: { ca: "#478ab6ff", ceplan: "#913247ff", siga: "#386c38ff" }
      },
      boxShadow: {
        soft: "0 6px 24px rgba(0,0,0,.08)"
      }
    }
  },
  plugins: []
};
