import React from 'react';

// Pantalla de error (12/11/2026): antes un error al dibujar cualquier pantalla dejaba la app en blanco y sin salida, y
// el cobrador no sabía si su cobro quedó guardado. Los cobros sin señal viven en IndexedDB y no se pierden al
// recargar. El detalle técnico va solo a la consola: nunca se muestra en pantalla.
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { fallo: false };
  }

  static getDerivedStateFromError() {
    return { fallo: true };
  }

  componentDidCatch(error) {
    console.error('Error al dibujar la pantalla:', error);
  }

  render() {
    if (!this.state.fallo) return this.props.children;
    return (
      <section className="page" role="alert" style={{ maxWidth: 480, margin: '48px auto', padding: '0 16px' }}>
        <div className="page-heading">
          <div>
            <h1>Algo falló en esta pantalla</h1>
            <p>Los cobros guardados en el celular no se pierden. Vuelve a intentar o regresa al inicio.</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="primary-button" type="button" onClick={() => this.setState({ fallo: false })}>Volver a intentar</button>
          <button className="secondary-button" type="button" onClick={() => window.location.assign('/')}>Ir al inicio</button>
        </div>
      </section>
    );
  }
}
