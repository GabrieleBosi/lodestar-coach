// The login page is a client component, so its title lives in a layout.
export const metadata = { title: "Sign in" };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
