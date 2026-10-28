"""Pruebas del modelo de proyección. Corren sin dependencias: python -m unittest -v (en apps/analytics).

Las mismas series y resultados están en apps/server/tests/prediccion.test.js: el respaldo local de la
API debe dar exactamente lo mismo que este servicio.
"""
import unittest

from modelo import mape, pronosticar

SERIE_CRECIENTE = [1200, 1260, 1310, 1290, 1380, 1420, 1460, 1500]


class ModeloTest(unittest.TestCase):
    def test_holt_con_tendencia(self):
        r = pronosticar(SERIE_CRECIENTE, 3)
        self.assertEqual(r['modelo'], 'holt')
        self.assertEqual((r['alpha'], r['beta']), (0.4, 0.5))
        self.assertEqual(r['mape'], 1.28)
        self.assertEqual(r['proyeccion_mensual'], [1540.65, 1580.61, 1620.57])
        self.assertEqual(r['total'], 4741.83)

    def test_ses_con_poca_historia(self):
        r = pronosticar([500, 520, 480, 510], 2)
        self.assertEqual((r['modelo'], r['alpha'], r['mape']), ('ses', 0.1, 3.29))
        self.assertEqual(r['proyeccion_mensual'], [500.82, 500.82])

    def test_promedio_y_sin_datos(self):
        self.assertEqual(pronosticar([300, 330], 3)['total'], 945)
        self.assertIsNone(pronosticar([300, 330], 3)['mape'])
        self.assertEqual(pronosticar([], 2)['modelo'], 'sin_datos')

    def test_mape(self):
        # Errores de 10 % y 20 % sobre los meses 2 y 3 → 15 %.
        self.assertEqual(mape([100, 100, 100], [90, 80]), 15.0)
        self.assertIsNone(mape([0, 0], [5]))


if __name__ == '__main__':
    unittest.main()
