import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import Checkout from "@/pages/Checkout";
import ResetPassword from "@/pages/ResetPassword";

const state = vi.hoisted(() => ({ ids: [] as string[], mutate: vi.fn(), post: vi.fn(), clearCart: vi.fn() }));
vi.mock("@/hooks/useBugs", () => ({ useBug: (id: string) => state.ids.includes(id) }));
vi.mock("@/components/Layout", () => ({ Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/useTitle", () => ({ useTitle: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useCart", () => ({ useCart: () => ({ items: [{ product: { id: "arc-pendant", name: "Arc Pendant Light", price: 485, images: [] }, quantity: 1 }], getSubtotal: () => 485, clearCart: state.clearCart }) }));
vi.mock("@/hooks/useAuth", () => ({ useResetToken: () => ({ data: { email: "pilot@example.test" }, isPending: false, isError: false }), useResetPassword: () => ({ mutate: state.mutate, isPending: false, isError: false }) }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), api: { post: state.post } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

test.each([[], ["V1"], ["V2"], ["V3"], ["V4"], ["V5"], ["V1", "V2", "V3", "V4", "V5"], []].map(ids => ({ ids })))(
  "actual checkout constraints and reset handler: $ids", async ({ ids }) => {
    state.ids = ids;
    state.post.mockResolvedValue({ orderId: "isolated-test-order", total: 510 });
    render(<MemoryRouter><Checkout /></MemoryRouter>);
    const email = screen.getByLabelText("Email *") as HTMLInputElement;
    const city = screen.getByLabelText("City *") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "invalid-address" } });
    expect(email.validity.typeMismatch).toBe(!ids.includes("V1"));
    expect(email.required).toBe(true);
    expect(city.validity.valueMissing).toBe(!ids.includes("V3"));
    expect((screen.getByLabelText("Postal Code *") as HTMLInputElement).required).toBe(true);
    // jsdom does not implement browser navigation/interactive submission. Check actual
    // attributes/validity, then the normal submit handler separately.
    for (const [label, value] of [["First Name *", "Pilot"], ["Last Name *", "Tester"], ["Email *", "pilot@example.test"], ["Street Address *", "123 Test Street"], ["City *", "Seoul"], ["Postal Code *", "04524"], ["Country *", "South Korea"]]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    await act(async () => { fireEvent.submit(email.closest("form")!); });
    await vi.waitFor(() => expect(state.clearCart).toHaveBeenCalledOnce());
    expect(state.post).toHaveBeenCalledOnce();
    cleanup();
    render(<MemoryRouter initialEntries={["/reset-password?token=synthetic-test-token"]}><ResetPassword /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("New Password *"), { target: { value: "FirstPass!123" } });
    fireEvent.change(screen.getByLabelText("Confirm Password *"), { target: { value: "OtherPass!456" } });
    fireEvent.click(screen.getByRole("button", { name: /Set Password/i }));
    if (ids.includes("V4")) {
      expect(state.mutate).toHaveBeenCalledWith({ token: "synthetic-test-token", password: "FirstPass!123" }, expect.any(Object));
    } else {
      expect(state.mutate).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent("두 비밀번호가 서로 다릅니다.");
    }
    state.mutate.mockClear();
    fireEvent.change(screen.getByLabelText("Confirm Password *"), { target: { value: "FirstPass!123" } });
    fireEvent.click(screen.getByRole("button", { name: /Set Password/i }));
    expect(state.mutate).toHaveBeenCalledOnce();
  },
);
