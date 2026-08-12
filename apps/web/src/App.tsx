import { useAuth } from "./auth/useAuth";
import { SignIn } from "./auth/SignIn";
import { AccessDenied } from "./auth/AccessDenied";
import { ManageUsersScreen } from "./admin/ManageUsersScreen";

export default function App() {
  const { state, signIn, signOut } = useAuth();

  switch (state.status) {
    case "loading":
      return <p>Loading…</p>;
    case "signedOut":
      return <SignIn onSignIn={signIn} />;
    case "denied":
      return <AccessDenied onSignOut={signOut} />;
    case "signedIn":
      return (
        <div>
          <header>
            <p>
              Signed in as {state.access.email} ({state.access.roles.join(", ")})
            </p>
            <button onClick={signOut}>Sign out</button>
          </header>
          {state.access.roles.includes("applicationAdministrator") ? (
            <ManageUsersScreen />
          ) : null}
        </div>
      );
  }
}
