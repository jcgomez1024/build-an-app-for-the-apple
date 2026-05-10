import * as Speech from "expo-speech";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { chatWithElvi, createCheckout, fetchMenu } from "./src/api";
import { copy } from "./src/i18n";
import type { CartLine, Customer, ElviAction, ElviResponse, Fulfillment, Language, MenuItem } from "./src/types";

type VoiceModule = {
  start: (locale: string) => Promise<void>;
  stop: () => Promise<void>;
  destroy: () => Promise<void>;
  removeAllListeners: () => void;
  onSpeechResults?: (event: { value?: string[] }) => void;
  onSpeechEnd?: () => void;
  onSpeechError?: () => void;
};

export default function App() {
  const [language, setLanguage] = useState<Language>("en");
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [fulfillment, setFulfillment] = useState<Fulfillment>("PICKUP");
  const [customer, setCustomer] = useState<Customer>({ name: "" });
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [typedCommand, setTypedCommand] = useState("");
  const [elviMessage, setElviMessage] = useState("");
  const [elviEngine, setElviEngine] = useState<"nvidia" | "fallback" | null>(null);
  const [processingElvi, setProcessingElvi] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const menuRef = useRef<MenuItem[]>([]);
  const cartRef = useRef<CartLine[]>([]);
  const customerRef = useRef<Customer>({ name: "" });
  const fulfillmentRef = useRef<Fulfillment>("PICKUP");
  const languageRef = useRef<Language>("en");
  const voiceRef = useRef<VoiceModule | null>(null);
  const t = copy[language];

  const total = useMemo(
    () => cart.reduce((sum, line) => sum + line.item.priceCents * line.quantity, 0),
    [cart]
  );

  useEffect(() => {
    fetchMenu()
      .then((items) => {
        menuRef.current = items;
        setMenu(items);
      })
      .catch((error) => Alert.alert("Menu error", error.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    menuRef.current = menu;
    cartRef.current = cart;
    customerRef.current = customer;
    fulfillmentRef.current = fulfillment;
    languageRef.current = language;
  }, [menu, cart, customer, fulfillment, language]);

  useEffect(() => {
    return () => {
      voiceRef.current?.destroy().then(() => voiceRef.current?.removeAllListeners());
    };
  }, []);

  function speak(message: string) {
    Speech.speak(message, { language: languageRef.current === "es" ? "es-US" : "en-US" });
  }

  function mergeCart(current: CartLine[], item: MenuItem, quantity = 1) {
    const existing = current.find((line) => line.item.id === item.id);
    if (existing) {
      return current.map((line) =>
        line.item.id === item.id ? { ...line, quantity: line.quantity + quantity } : line
      );
    }
    return [...current, { item, quantity }];
  }

  function addItem(item: MenuItem, quantity = 1) {
    const nextCart = mergeCart(cartRef.current, item, quantity);
    cartRef.current = nextCart;
    setCart(nextCart);
    const activeLanguage = languageRef.current;
    speak(`${copy[activeLanguage].added} ${quantity} ${activeLanguage === "es" ? item.nameEs : item.name}`);
    return nextCart;
  }

  async function applyTranscript(value: string) {
    setTranscript(value);
    setProcessingElvi(true);
    try {
      const response = await chatWithElvi({ transcript: value, language: languageRef.current });
      applyElviActions(response);
    } catch (error) {
      Alert.alert("Elvi error", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setProcessingElvi(false);
    }
  }

  function applyElviActions(response: ElviResponse) {
    setElviMessage(response.reply);
    setElviEngine(response.engine);
    if (response.language !== languageRef.current) {
      languageRef.current = response.language;
      setLanguage(response.language);
    }

    let nextCart = cartRef.current;
    let nextCustomer = customerRef.current;
    let nextFulfillment = fulfillmentRef.current;
    let checkoutRequested = false;

    for (const action of response.actions) {
      if (action.type === "add_item") {
        const item = menuRef.current.find((entry) => entry.id === action.itemId);
        if (item) {
          nextCart = mergeCart(nextCart, item, action.quantity || 1);
        }
        continue;
      }
      if (action.type === "set_fulfillment") {
        nextFulfillment = action.fulfillment;
        continue;
      }
      if (action.type === "set_address") {
        nextCustomer = { ...nextCustomer, address: action.address };
        continue;
      }
      if (action.type === "set_customer") {
        nextCustomer = {
          ...nextCustomer,
          ...(action.name ? { name: action.name } : {}),
          ...(action.phone ? { phone: action.phone } : {}),
          ...(action.email ? { email: action.email } : {})
        };
        continue;
      }
      if (action.type === "checkout") {
        checkoutRequested = true;
      }
    }

    cartRef.current = nextCart;
    setCart(nextCart);
    fulfillmentRef.current = nextFulfillment;
    setFulfillment(nextFulfillment);
    customerRef.current = nextCustomer;
    setCustomer(nextCustomer);

    speak(response.reply || copy[languageRef.current].noMatch);

    if (checkoutRequested) {
      checkout(nextCart, nextFulfillment, nextCustomer);
    }
  }

  function onSpeechResults(event: { value?: string[] }) {
    const value = event.value?.[0];
    if (value) {
      void applyTranscript(value);
    }
  }

  function getVoiceModule() {
    try {
      const voicePackage = require("@react-native-voice/voice") as { default?: VoiceModule };
      const voice = voicePackage.default || (voicePackage as VoiceModule);
      voice.onSpeechResults = onSpeechResults;
      voice.onSpeechEnd = () => setListening(false);
      voice.onSpeechError = () => setListening(false);
      voiceRef.current = voice;
      return voice;
    } catch {
      return null;
    }
  }

  async function toggleListening() {
    const voice = getVoiceModule();
    if (!voice) {
      Alert.alert("Voice unavailable", "Use a development build for native voice, or type a command below.");
      return;
    }

    if (listening) {
      await voice.stop();
      setListening(false);
      return;
    }

    setListening(true);
    speak(t.ready);
    await voice.start(language === "es" ? "es-US" : "en-US");
  }

  async function checkout(
    checkoutCart = cartRef.current,
    checkoutFulfillment = fulfillmentRef.current,
    checkoutCustomer = customerRef.current
  ) {
    const activeCopy = copy[languageRef.current];
    if (!checkoutCart.length) {
      Alert.alert(activeCopy.order, activeCopy.empty);
      return;
    }
    if (checkoutFulfillment === "DELIVERY" && !checkoutCustomer.address) {
      Alert.alert(activeCopy.delivery, activeCopy.addressPlaceholder);
      return;
    }

    setCheckingOut(true);
    try {
      const result = await createCheckout({
        cart: checkoutCart,
        fulfillment: checkoutFulfillment,
        customer: checkoutCustomer
      });
      await Linking.openURL(result.checkoutUrl);
    } catch (error) {
      Alert.alert("Checkout error", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setCheckingOut(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>{t.title}</Text>
            <Text style={styles.subtitle}>{t.subtitle}</Text>
          </View>
          <View style={styles.languageSwitch}>
            {(["en", "es"] as Language[]).map((option) => (
              <TouchableOpacity
                key={option}
                onPress={() => setLanguage(option)}
                style={[styles.pill, language === option && styles.pillActive]}
              >
                <Text style={[styles.pillText, language === option && styles.pillTextActive]}>
                  {option.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity
          onPress={toggleListening}
          style={[styles.voiceButton, listening && styles.voiceButtonActive]}
        >
          <Text style={styles.voiceButtonText}>{listening ? t.stop : t.listen}</Text>
        </TouchableOpacity>
        <View style={styles.avatarCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>E</Text>
          </View>
          <View style={styles.avatarTextWrap}>
            <Text style={styles.avatarName}>Elvi</Text>
            <Text style={styles.avatarMessage}>{elviMessage || t.ready}</Text>
            {elviEngine ? (
              <Text style={styles.avatarEngine}>
                {elviEngine === "nvidia" ? "NVIDIA AI" : "Fallback parser"}
              </Text>
            ) : null}
          </View>
        </View>
        <Text style={styles.prompt}>{transcript || t.prompt}</Text>
        <View style={styles.commandRow}>
          <TextInput
            placeholder={t.prompt}
            value={typedCommand}
            onChangeText={setTypedCommand}
            style={[styles.input, styles.commandInput]}
          />
          <TouchableOpacity
            onPress={() => {
              if (typedCommand.trim()) {
                void applyTranscript(typedCommand.trim());
                setTypedCommand("");
              }
            }}
            style={[styles.commandButton, processingElvi && styles.commandButtonDisabled]}
            disabled={processingElvi}
          >
            <Text style={styles.commandButtonText}>{processingElvi ? "..." : t.runCommand}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.segment}>
          {(["PICKUP", "DELIVERY"] as Fulfillment[]).map((option) => (
            <TouchableOpacity
              key={option}
              onPress={() => setFulfillment(option)}
              style={[styles.segmentOption, fulfillment === option && styles.segmentOptionActive]}
            >
              <Text
                style={[
                  styles.segmentText,
                  fulfillment === option && styles.segmentTextActive
                ]}
              >
                {option === "PICKUP" ? t.pickup : t.delivery}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.menuGrid}>
          {menu.map((item) => (
            <TouchableOpacity key={item.id} style={styles.menuItem} onPress={() => addItem(item)}>
              <Text style={styles.menuName}>{language === "es" ? item.nameEs : item.name}</Text>
              <Text style={styles.price}>{formatMoney(item.priceCents)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>{t.order}</Text>
          {cart.length === 0 ? (
            <Text style={styles.empty}>{t.empty}</Text>
          ) : (
            cart.map((line) => (
              <View key={line.item.id} style={styles.cartLine}>
                <Text style={styles.cartName}>
                  {line.quantity} x {language === "es" ? line.item.nameEs : line.item.name}
                </Text>
                <Text style={styles.price}>{formatMoney(line.quantity * line.item.priceCents)}</Text>
              </View>
            ))
          )}
          <View style={styles.cartLine}>
            <Text style={styles.total}>{t.total}</Text>
            <Text style={styles.total}>{formatMoney(total)}</Text>
          </View>
        </View>

        <View style={styles.form}>
          <TextInput
            placeholder={t.namePlaceholder}
            value={customer.name}
            onChangeText={(name) => setCustomer((current) => ({ ...current, name }))}
            style={styles.input}
          />
          <TextInput
            placeholder={t.phonePlaceholder}
            value={customer.phone}
            onChangeText={(phone) => setCustomer((current) => ({ ...current, phone }))}
            keyboardType="phone-pad"
            style={styles.input}
          />
          <TextInput
            placeholder={t.emailPlaceholder}
            value={customer.email}
            onChangeText={(email) => setCustomer((current) => ({ ...current, email }))}
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
          />
          {fulfillment === "DELIVERY" && (
            <TextInput
              placeholder={t.addressPlaceholder}
              value={customer.address}
              onChangeText={(address) => setCustomer((current) => ({ ...current, address }))}
              style={styles.input}
            />
          )}
        </View>

        <TouchableOpacity disabled={checkingOut} onPress={() => checkout()} style={styles.checkout}>
          <Text style={styles.checkoutText}>{checkingOut ? "..." : t.checkout}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#fff8ef"
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  content: {
    padding: 20,
    gap: 18
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "center"
  },
  title: {
    fontSize: 34,
    fontWeight: "800",
    color: "#17201c"
  },
  subtitle: {
    fontSize: 16,
    color: "#52615b",
    marginTop: 4
  },
  languageSwitch: {
    flexDirection: "row",
    backgroundColor: "#ffffff",
    borderRadius: 8,
    padding: 4
  },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6
  },
  pillActive: {
    backgroundColor: "#1b5e3c"
  },
  pillText: {
    color: "#1b5e3c",
    fontWeight: "700"
  },
  pillTextActive: {
    color: "#ffffff"
  },
  voiceButton: {
    backgroundColor: "#d8392b",
    minHeight: 86,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center"
  },
  voiceButtonActive: {
    backgroundColor: "#8f221a"
  },
  voiceButtonText: {
    color: "#ffffff",
    fontSize: 25,
    fontWeight: "800"
  },
  avatarCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ead9c0",
    padding: 12,
    flexDirection: "row",
    gap: 12,
    alignItems: "center"
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#1b5e3c",
    alignItems: "center",
    justifyContent: "center"
  },
  avatarInitial: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900"
  },
  avatarTextWrap: {
    flex: 1,
    gap: 4
  },
  avatarName: {
    fontSize: 16,
    fontWeight: "900",
    color: "#17201c"
  },
  avatarMessage: {
    color: "#3b4a44",
    lineHeight: 20
  },
  avatarEngine: {
    color: "#7a847f",
    fontSize: 12,
    fontWeight: "700"
  },
  prompt: {
    fontSize: 16,
    lineHeight: 22,
    color: "#3d4945"
  },
  segment: {
    flexDirection: "row",
    backgroundColor: "#ffffff",
    borderRadius: 8,
    padding: 4
  },
  segmentOption: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 6
  },
  segmentOptionActive: {
    backgroundColor: "#ffcf56"
  },
  segmentText: {
    color: "#44524d",
    fontWeight: "700"
  },
  segmentTextActive: {
    color: "#17201c"
  },
  menuGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  menuItem: {
    width: "48%",
    minHeight: 94,
    backgroundColor: "#ffffff",
    borderColor: "#f0d5b2",
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    justifyContent: "space-between"
  },
  menuName: {
    fontSize: 17,
    fontWeight: "800",
    color: "#1b241f"
  },
  price: {
    fontSize: 15,
    color: "#52615b",
    fontWeight: "700"
  },
  panel: {
    backgroundColor: "#ffffff",
    borderRadius: 8,
    padding: 16,
    gap: 12
  },
  panelTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#17201c"
  },
  empty: {
    color: "#6b756f"
  },
  cartLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12
  },
  cartName: {
    flex: 1,
    color: "#26302b",
    fontWeight: "600"
  },
  total: {
    color: "#17201c",
    fontSize: 18,
    fontWeight: "900"
  },
  form: {
    gap: 10
  },
  input: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e4c59d",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    fontSize: 16
  },
  commandRow: {
    gap: 10
  },
  commandInput: {
    minHeight: 58
  },
  commandButton: {
    backgroundColor: "#17201c",
    borderRadius: 8,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center"
  },
  commandButtonDisabled: {
    opacity: 0.75
  },
  commandButtonText: {
    color: "#ffffff",
    fontWeight: "800",
    fontSize: 16
  },
  checkout: {
    backgroundColor: "#1b5e3c",
    borderRadius: 8,
    minHeight: 58,
    alignItems: "center",
    justifyContent: "center"
  },
  checkoutText: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "900"
  }
});
