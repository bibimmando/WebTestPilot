import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { RequireLogin } from "@/components/RequireLogin";
import { AuthModalProvider } from "@/lib/authModal";
import { CommunitiesProvider } from "@/lib/communities";
import { SessionProvider } from "@/lib/session";
import { AuthPage } from "@/pages/AuthPages";
import { CommunitiesPage } from "@/pages/CommunitiesPage";
import { CommunityPage } from "@/pages/CommunityPage";
import { GamePage } from "@/pages/GamePage";
import { GamesPage } from "@/pages/GamesPage";
import { MessagesPage } from "@/pages/MessagesPage";
import { ModPage } from "@/pages/ModPage";
import { HomePage } from "@/pages/HomePage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { NotificationsPage } from "@/pages/NotificationsPage";
import { PoliciesPage } from "@/pages/PoliciesPage";
import { PostPage } from "@/pages/PostPage";
import { SearchPage } from "@/pages/SearchPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SubmitPage } from "@/pages/SubmitPage";
import { UserPage } from "@/pages/UserPage";

/**
 * 주소 구조
 *   /                          홈 (가입한 커뮤니티 글)
 *   /popular  /all             인기 · 전체
 *   /explore                   커뮤니티 탐색 (예전 주소 /communities 는 이리로 넘긴다)
 *   /games  /games/:id         Agora 게임 목록 · 게임 한 판
 *   /c/:name                   커뮤니티
 *   /c/:name/comments/:id/:slug  글 + 댓글
 *   /submit  /c/:name/submit   글쓰기
 *   /c/:name/mod(/bans|/members|/settings)  운영 도구 (운영진만)
 *   /u/:name                   사용자 (?tab=comments|saved|hidden)
 *   /notifications             알림
 *   /messages(/new|/:name)     쪽지
 *   /settings(/account|/notifications)  설정
 *   /search?q=                 검색
 *   /policies/:doc             사이트 정책 (rules · privacy · terms · accessibility)
 *   /login  /signup            로그인 · 회원가입 (평소에는 모달로 뜬다)
 * 정렬·기간·말머리는 ?sort= &t= &flair= 로 주소에 남긴다.
 */
export default function App() {
  return (
    <SessionProvider>
      <CommunitiesProvider>
        <AuthModalProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage feed="home" />} />
            <Route path="popular" element={<HomePage feed="popular" />} />
            <Route path="all" element={<HomePage feed="all" />} />
            <Route path="explore" element={<CommunitiesPage />} />
            <Route path="communities" element={<ToExplore />} />
            <Route path="games" element={<GamesPage />} />
            <Route path="games/:id" element={<GamePage />} />
            <Route path="c/:name" element={<CommunityPage />} />
            <Route path="c/:name/submit" element={<SubmitPage />} />
            <Route path="c/:name/comments/:id" element={<PostPage />} />
            <Route path="c/:name/comments/:id/:slug" element={<PostPage />} />
            <Route path="submit" element={<SubmitPage />} />
            <Route path="c/:name/mod" element={<RequireLogin><ModPage tab="queue" /></RequireLogin>} />
            <Route path="c/:name/mod/bans" element={<RequireLogin><ModPage tab="bans" /></RequireLogin>} />
            <Route path="c/:name/mod/members" element={<RequireLogin><ModPage tab="members" /></RequireLogin>} />
            <Route path="c/:name/mod/settings" element={<RequireLogin><ModPage tab="settings" /></RequireLogin>} />
            <Route path="u/:name" element={<UserPage />} />
            <Route path="notifications" element={<RequireLogin><NotificationsPage /></RequireLogin>} />
            <Route path="messages" element={<RequireLogin><MessagesPage /></RequireLogin>} />
            <Route path="messages/new" element={<RequireLogin><MessagesPage compose /></RequireLogin>} />
            <Route path="messages/:name" element={<RequireLogin><MessagesPage /></RequireLogin>} />
            <Route path="settings" element={<RequireLogin><SettingsPage tab="profile" /></RequireLogin>} />
            <Route path="settings/account" element={<RequireLogin><SettingsPage tab="account" /></RequireLogin>} />
            <Route path="settings/notifications" element={<RequireLogin><SettingsPage tab="notifications" /></RequireLogin>} />
            <Route path="search" element={<SearchPage />} />
            <Route path="policies/:doc" element={<PoliciesPage />} />
            <Route path="login" element={<AuthPage view="login" />} />
            <Route path="signup" element={<AuthPage view="signup" />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
        </AuthModalProvider>
      </CommunitiesProvider>
    </SessionProvider>
  );
}

/** 예전 주소 /communities?category=… 를 /explore 로 넘긴다 (분류 거르기는 그대로). */
function ToExplore() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/explore", search }} replace />;
}
