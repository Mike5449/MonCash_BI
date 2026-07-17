import { ChakraProvider, createSystem, defineConfig, defaultConfig } from "@chakra-ui/react"
import { ColorModeProvider } from "./color-mode"

const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        brand: {
          50: { value: "#feedee" },
          100: { value: "#fdd2d4" },
          200: { value: "#fba6a9" },
          300: { value: "#f9797d" },
          400: { value: "#f64d52" },
          500: { value: "#E31B23" }, // MonCash Red
          600: { value: "#c2161d" },
          700: { value: "#a11117" },
          800: { value: "#800d11" },
          900: { value: "#5f080b" },
        },
      },
      fonts: {
        heading: { value: "'Inter', sans-serif" },
        body: { value: "'Inter', sans-serif" },
      },
    },
    semanticTokens: {
      colors: {
        bg: {
          subtle: { value: { base: "#f7f9fc", _dark: "#1a1a1a" } },
          surface: { value: { base: "#ffffff", _dark: "#2d2d2d" } },
        },
        border: {
          subtle: { value: { base: "#edf2f7", _dark: "#404040" } },
        },
      },
    },
  },
})

export const system = createSystem(defaultConfig, config)

export function Provider(props: { children: React.ReactNode }) {
  return (
    <ChakraProvider value={system}>
      <ColorModeProvider forcedTheme="light">
        {props.children}
      </ColorModeProvider>
    </ChakraProvider>
  )
}
