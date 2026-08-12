import { Button, StyleSheet, Text, View } from "react-native";

interface AccessDeniedScreenProps {
  onSignOut: () => void;
}

export function AccessDeniedScreen({ onSignOut }: AccessDeniedScreenProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Access denied</Text>
      <Text style={styles.body}>
        Your account hasn't been granted access to LiveOakv3. Contact an
        Application Administrator to be invited.
      </Text>
      <Button title="Sign out" onPress={onSignOut} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
  },
  body: {
    textAlign: "center",
  },
});
