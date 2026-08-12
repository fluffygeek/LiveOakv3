interface AccessDeniedProps {
  onSignOut: () => void;
}

export function AccessDenied({ onSignOut }: AccessDeniedProps) {
  return (
    <div>
      <h1>Access denied</h1>
      <p>
        Your account hasn't been granted access to LiveOakv3. Contact an
        Application Administrator to be invited.
      </p>
      <button onClick={onSignOut}>Sign out</button>
    </div>
  );
}
