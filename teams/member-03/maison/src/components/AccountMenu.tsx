import { Link, useNavigate } from "react-router-dom";
import { User, Package, LogOut, LogIn, UserPlus, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLogout, useMe } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

export const AccountMenu = () => {
  const { user, isLoggedIn } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleLogout = () => {
    if (logout.isPending) return; // 중복 제출 방어
    logout.mutate(undefined, {
      onSuccess: () => {
        toast({
          title: "Signed out",
          description: "로그아웃되었습니다.",
        });
        navigate("/");
      },
      onError: () => {
        toast({
          title: "로그아웃 실패",
          description: "잠시 후 다시 시도해 주세요.",
          variant: "destructive",
        });
      },
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={isLoggedIn ? `계정 메뉴 (${user?.name})` : "계정 메뉴"}
          className="relative p-2 hover:bg-accent transition-colors duration-300 group"
        >
          <User className="w-5 h-5 transition-transform duration-300 group-hover:scale-110" />
          {isLoggedIn && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full" />
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56 rounded-none">
        {isLoggedIn ? (
          <>
            <DropdownMenuLabel className="font-normal">
              <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground/60 mb-1">
                Signed In
              </p>
              <p className="font-serif text-base truncate">{user?.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {user?.email}
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="rounded-none">
              <Link to="/orders" className="cursor-pointer">
                <Package className="w-4 h-4 mr-3" />
                <span className="text-sm tracking-[0.05em]">Orders</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="rounded-none">
              <Link to="/account" className="cursor-pointer">
                <Settings className="w-4 h-4 mr-3" />
                <span className="text-sm tracking-[0.05em]">Account</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={handleLogout}
              disabled={logout.isPending}
              className="rounded-none cursor-pointer"
            >
              <LogOut className="w-4 h-4 mr-3" />
              <span className="text-sm tracking-[0.05em]">
                {logout.isPending ? "Signing Out..." : "Sign Out"}
              </span>
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuLabel className="font-normal">
              <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground/60">
                Account
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="rounded-none">
              <Link to="/login" className="cursor-pointer">
                <LogIn className="w-4 h-4 mr-3" />
                <span className="text-sm tracking-[0.05em]">Sign In</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="rounded-none">
              <Link to="/signup" className="cursor-pointer">
                <UserPlus className="w-4 h-4 mr-3" />
                <span className="text-sm tracking-[0.05em]">Create Account</span>
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
