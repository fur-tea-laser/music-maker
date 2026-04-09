import { useState } from "preact/hooks";
import styles from "../styles/App.module.scss";

export const App = () => {
  const [count, setCount] = useState(0);

  return (
    <div class={styles.container}>
      <h1>Hello, Preact!</h1>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Increment</button>
    </div>
  );
};
