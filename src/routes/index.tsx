import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    // Home is the Farmer File list: the operation starts from the farmer.
    throw redirect({ to: "/farmers" });
  },
  component: () => null,
});
