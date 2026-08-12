interface SignInProps {
  onSignIn: () => void;
}

export function SignIn({ onSignIn }: SignInProps) {
  return (
    <div>
      <h1>LiveOakv3</h1>
      <p>Sign in with your company Google account.</p>
      <button onClick={onSignIn}>Sign in with Google</button>
    </div>
  );
}
