import type { Metadata } from "next";

// Standalone "device" surface — intentionally outside the (dashboard) route
// group so it renders with no sidebar/header/nav, like a phone screen rather
// than a desktop console page. Auth is still required (same-origin session
// cookie); each page under this group is responsible for its own auth guard
// so the phone-frame chrome can render its own loading/unauthenticated state.
export const metadata: Metadata = {
  title: "OneComputer Device",
};

export default function DeviceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-neutral-950 p-6">
      {children}
    </div>
  );
}
