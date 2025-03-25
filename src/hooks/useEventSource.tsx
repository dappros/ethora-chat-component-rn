import { useEffect, useState } from "react";

export const useEventSource = (url: string | null) => {
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);

  useEffect(() => {
    if (!url) return;

    const e = new EventSource(url, { withCredentials: true });
    setEventSource(e);

    e.onmessage = (event) => {
      try {
        const parsedData = JSON.parse(event.data);
        setData(parsedData);
      } catch (err) {
        console.error("Error event.data", err);
        setError("Error data");
      }
    };

    e.onerror = (err) => {
      console.error("Error EventSource", err);
      setError("Error connection");
      e.close();
    };

    return () => {
      e.close();
    };
  }, [url]);

  return { data, error, eventSource };
};